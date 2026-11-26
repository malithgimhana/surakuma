param([switch]$SkipBuild, [string]$TestFilter = "", [string]$ApiDll = "", [switch]$LiveOpenAi, [switch]$LiveMapping,
    [ValidatePattern('^[A-Za-z0-9_]+$')][string]$LocalDbInstance = 'MSSQLLocalDB')
$ErrorActionPreference = 'Stop'
$previousSettings = @{}
foreach ($setting in @('ConnectionStrings__Default', 'ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT',
    'ASPNETCORE_URLS', 'Seed__Password', 'SURAKUMA_ACCEPTANCE_PASSWORD', 'Jwt__Key', 'Email__Provider',
    'Ai__OpenAiApiKey', 'OPENAI_API_KEY', 'Ai__Tasks__triage__Provider', 'Ai__Tasks__embedding__Provider',
    'Ai__EnableRestrictedTriage', 'Ai__ApprovedSyntheticAccountIds__0', 'Ai__OperationalBriefingsEnabled',
    'Ai__PublicTranslationEnabled', 'SURAKUMA_ACCEPTANCE_AI_PROVIDER', 'Mapping__ApiKey', 'SURAKUMA_ACCEPTANCE_LIVE_MAPPING', 'BrowserPush__PrivateKey',
    'Storage__DevelopmentDataPath', 'Storage__EvidencePath', 'Cors__Origins__0', 'RateLimits__AuthPermitLimit',
    'RateLimits__GlobalPermitLimit', 'VITE_API_URL', 'SURAKUMA_API_PROXY')) {
    $previousSettings[$setting] = [Environment]::GetEnvironmentVariable($setting, 'Process')
}
$repo = Split-Path $PSScriptRoot -Parent
$database = 'Surakuma_Assessment_Acceptance_' + [Guid]::NewGuid().ToString('N')
$logs = Join-Path $repo ('tmp/acceptance/' + $database)
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$server = "(localdb)\$LocalDbInstance"
$env:ConnectionStrings__Default = "Server=$server;Database=$database;Trusted_Connection=True;TrustServerCertificate=True"
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:DOTNET_ENVIRONMENT = 'Development'
$env:ASPNETCORE_URLS = 'https://localhost:7143'
$env:Seed__Password = 'Acceptance!' + [Guid]::NewGuid().ToString('N') + 'a9'
$env:SURAKUMA_ACCEPTANCE_PASSWORD = $env:Seed__Password
$env:Jwt__Key = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(64))
$env:Email__Provider = 'Capture'
$env:Ai__OpenAiApiKey = if ($LiveOpenAi) { $env:Ai__OpenAiApiKey ?? $env:OPENAI_API_KEY } else { '' }
$env:Ai__Tasks__triage__Provider = if ($LiveOpenAi) { 'OpenAI' } else { 'Rules' }
$env:Ai__Tasks__embedding__Provider = if ($LiveOpenAi) { 'OpenAI' } else { 'Rules' }
$env:Ai__EnableRestrictedTriage = 'false'
$env:SURAKUMA_ACCEPTANCE_AI_PROVIDER = if ($LiveOpenAi) { 'OpenAI' } else { $null }
$env:Mapping__ApiKey = if ($LiveMapping) { $env:Mapping__ApiKey } else { '' }
$env:SURAKUMA_ACCEPTANCE_LIVE_MAPPING = if ($LiveMapping) { '1' } else { $null }
$env:BrowserPush__PrivateKey = ''
$env:Ai__OperationalBriefingsEnabled = 'false'
$env:Ai__PublicTranslationEnabled = 'false'
$env:Storage__EvidencePath = Join-Path $logs 'evidence'
$env:Storage__DevelopmentDataPath = $logs
$env:Cors__Origins__0 = 'http://127.0.0.1:5192'
$env:RateLimits__AuthPermitLimit = '100'
$env:RateLimits__GlobalPermitLimit = '1500'
$env:VITE_API_URL = '/api/v1'
$env:SURAKUMA_API_PROXY = 'https://localhost:7143'
$project = Join-Path $repo 'backend/src/Surakuma.Api'
$dll = if ($ApiDll) { (Resolve-Path -LiteralPath $ApiDll).Path } else { Join-Path $project 'bin/Release/net10.0/Surakuma.Api.dll' }
$apiProcess = $null
try {
    if ($LiveOpenAi -and !$env:Ai__OpenAiApiKey) { throw 'Live OpenAI acceptance requires a configured API key.' }
    if ($LiveMapping -and !$env:Mapping__ApiKey) { throw 'Live mapping acceptance requires a configured API key.' }
    if (!$TestFilter -and ($LiveOpenAi -or $LiveMapping)) {
        $patterns = @()
        if ($LiveOpenAi) { $patterns += 'request intelligence' }
        if ($LiveMapping) { $patterns += 'mapping provider' }
        $TestFilter = $patterns -join '|'
    }
    $occupied = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
        Where-Object { $_.Port -in 7143, 5192 }
    if ($occupied) { throw 'Acceptance requires unused local ports 7143 and 5192.' }
    if (!$SkipBuild -and !$ApiDll) {
        & dotnet build $project -c Release --no-restore -m:1
        if ($LASTEXITCODE) { throw 'API build failed.' }
    }
    & dotnet $dll --contentRoot $project --seed-assessment *> (Join-Path $logs 'migration.log')
    if ($LASTEXITCODE) { throw "Acceptance migration failed; see $logs/migration.log" }
    if ($LiveOpenAi) {
        $syntheticAccount = (& sqlcmd -S $server -d $database -E -b -h -1 -W -Q "SET NOCOUNT ON; SELECT Id FROM AspNetUsers WHERE NormalizedEmail = 'CITIZEN@SURAKUMA.TEST';" | Out-String).Trim()
        if ($LASTEXITCODE -or $syntheticAccount -notmatch '^[0-9a-f-]{36}$') { throw 'The isolated seed citizen could not be identified.' }
        $env:Ai__ApprovedSyntheticAccountIds__0 = $syntheticAccount
    }
    $apiProcess = Start-Process dotnet -ArgumentList "`"$dll`" --contentRoot `"$project`"" -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'api.log') -RedirectStandardError (Join-Path $logs 'api-error.log')
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($apiProcess.HasExited) { throw 'Acceptance API exited during startup.' }
        try { $ready = (Invoke-WebRequest 'https://localhost:7143/api/v1/ready' -SkipCertificateCheck).StatusCode -eq 200 } catch { }
        if ($ready) { break }
        Start-Sleep -Seconds 1
    }
    if (!$ready) { throw 'Acceptance API did not become ready.' }
    Write-Output "Acceptance API ready. Isolated database: $database"
    Invoke-WebRequest 'https://localhost:7143/swagger/v1/swagger.json' -SkipCertificateCheck -OutFile (Join-Path $logs 'openapi.json')
    $env:Ai__OpenAiApiKey = $null
    $env:OPENAI_API_KEY = $null
    $env:Mapping__ApiKey = $null
    Push-Location (Join-Path $repo 'frontend')
    try {
        if ($TestFilter) { & npx playwright test --config playwright.live-international.config.ts --grep $TestFilter }
        else { & npx playwright test --config playwright.live-international.config.ts }
        if ($LASTEXITCODE) { throw 'Live international acceptance failed.' }
    } finally { Pop-Location }
    if ($LiveOpenAi) {
        & sqlcmd -S $server -d $database -E -b -W -Q "SET NOCOUNT ON; IF NOT EXISTS (SELECT 1 FROM dbo.AiInvocation WHERE Task = 'embedding' AND Provider = 'OpenAI' AND State = 'Completed') THROW 50000, 'Live OpenAI embeddings did not complete.', 1; SELECT Task, Model, InputTokens, OutputTokens FROM dbo.AiInvocation WHERE Provider = 'OpenAI' AND State = 'Completed';"
        if ($LASTEXITCODE) { throw 'Live OpenAI embeddings validation failed.' }
    }
    Write-Output "Acceptance passed. Isolated database retained: $database"
} finally {
    if ($apiProcess -and !$apiProcess.HasExited) { Stop-Process -Id $apiProcess.Id }
    foreach ($setting in $previousSettings.Keys) {
        if ($null -eq $previousSettings[$setting]) { Remove-Item -LiteralPath "Env:$setting" -ErrorAction SilentlyContinue }
        else { Set-Item -LiteralPath "Env:$setting" -Value $previousSettings[$setting] }
    }
}
