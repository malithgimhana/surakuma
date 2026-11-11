param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$database = 'Surakuma_Acceptance_' + [Guid]::NewGuid().ToString('N')
$logs = Join-Path $repo ('tmp/acceptance/' + $database)
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$env:ConnectionStrings__Default = "Server=(localdb)\MSSQLLocalDB;Database=$database;Trusted_Connection=True;TrustServerCertificate=True"
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:ASPNETCORE_URLS = 'https://localhost:7143'
$env:Seed__Password = 'Acceptance!' + [Guid]::NewGuid().ToString('N') + 'a9'
$env:SURAKUMA_ACCEPTANCE_PASSWORD = $env:Seed__Password
$env:Jwt__Key = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(64))
$env:Email__Provider = 'Capture'
$env:Cors__Origins__0 = 'http://127.0.0.1:5192'
$env:RateLimits__AuthPermitLimit = '100'
$env:VITE_API_URL = '/api/v1'
$env:SURAKUMA_API_PROXY = 'https://localhost:7143'
$project = Join-Path $repo 'backend/src/Surakuma.Api'
$dll = Join-Path $project 'bin/Release/net10.0/Surakuma.Api.dll'
$apiProcess = $null
try {
    if (!$SkipBuild) {
        & dotnet build $project -c Release --no-restore -m:1
        if ($LASTEXITCODE) { throw 'API build failed.' }
    }
    & dotnet $dll --contentRoot $project --migrate *> (Join-Path $logs 'migration.log')
    if ($LASTEXITCODE) { throw "Acceptance migration failed; see $logs/migration.log" }
    $apiProcess = Start-Process dotnet -ArgumentList "`"$dll`" --contentRoot `"$project`"" -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'api.log') -RedirectStandardError (Join-Path $logs 'api-error.log')
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try { $ready = (Invoke-WebRequest 'https://localhost:7143/api/v1/ready' -SkipCertificateCheck).StatusCode -eq 200 } catch { }
        if ($ready) { break }
        if ($apiProcess.HasExited) { throw 'Acceptance API exited during startup.' }
        Start-Sleep -Seconds 1
    }
    if (!$ready) { throw 'Acceptance API did not become ready.' }
    Push-Location (Join-Path $repo 'frontend')
    try {
        & npx playwright test --config playwright.live-international.config.ts
        if ($LASTEXITCODE) { throw 'Live international acceptance failed.' }
    } finally { Pop-Location }
    Write-Output "Acceptance passed. Isolated database retained: $database"
} finally {
    if ($apiProcess -and !$apiProcess.HasExited) { Stop-Process -Id $apiProcess.Id }
    Remove-Item Env:SURAKUMA_ACCEPTANCE_PASSWORD,Env:Seed__Password,Env:Jwt__Key -ErrorAction SilentlyContinue
}
