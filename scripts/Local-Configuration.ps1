function Get-SurakumaTools {
    $commands = @{}
    foreach ($name in @('dotnet', 'node', 'npm.cmd', 'sqllocaldb')) {
        $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if (!$command) { throw "Missing $name. Install the Windows prerequisites listed in README.md and reopen PowerShell." }
        $commands[$name] = $command.Source
    }
    if (!(& $commands.dotnet --list-sdks | Where-Object { $_ -match '^10\.' })) {
        throw 'Install the .NET 10 SDK before continuing.'
    }
    $nodeVersion = & $commands.node --version
    if ($LASTEXITCODE -or ([version]$nodeVersion.TrimStart('v')).Major -lt 24) {
        throw 'Install Node.js 24 LTS before continuing.'
    }
    return $commands
}

function Start-SurakumaLocalDb($Tools, [string]$Instance) {
    $instances = & $Tools.sqllocaldb info
    if ($LASTEXITCODE) { throw 'LocalDB could not list instances. Run PowerShell as the Windows account that owns the LocalDB instance.' }
    if ($Instance -notin @($instances | ForEach-Object { $_.Trim() })) {
        & $Tools.sqllocaldb create $Instance
        if ($LASTEXITCODE) { throw "Could not create LocalDB instance $Instance." }
    }
    & $Tools.sqllocaldb start $Instance
    if ($LASTEXITCODE) { throw "Could not start LocalDB instance $Instance." }
}

function Get-SurakumaEnvironment([string]$Instance, [string]$Database, [bool]$Assessment) {
    $settings = @{
        ASPNETCORE_ENVIRONMENT = 'Development'
        DOTNET_ENVIRONMENT = 'Development'
        ConnectionStrings__Default = "Server=(localdb)\$Instance;Database=$Database;Trusted_Connection=True;TrustServerCertificate=True;Connect Timeout=10"
    }
    if ($Assessment) {
        $data = Join-Path (Split-Path -Parent $PSScriptRoot) "backend/data/assessment/$Database"
        $settings.Storage__DevelopmentDataPath = $data
        $settings.Storage__EvidencePath = Join-Path $data 'evidence'
        $settings.Email__Provider = 'Capture'
        $settings.Ai__OpenAiApiKey = ''
        $settings.OPENAI_API_KEY = ''
        $settings.Ai__Tasks__triage__Provider = 'Rules'
        $settings.Ai__Tasks__embedding__Provider = 'Rules'
        $settings.Mapping__ApiKey = ''
        $settings.BrowserPush__PrivateKey = ''
        $settings.Jwt__Key = $null
    } else {
        $envFile = Join-Path (Split-Path -Parent $PSScriptRoot) '.env'
        if (!$env:Mapping__ApiKey -and (Test-Path -LiteralPath $envFile -PathType Leaf)) {
            $entry = Select-String -LiteralPath $envFile -Pattern '^\s*Mapping__ApiKey\s*=\s*(.*?)\s*$' | Select-Object -Last 1
            if ($entry) { $settings.Mapping__ApiKey = $entry.Matches[0].Groups[1].Value.Trim([char[]]@('"', "'")) }
        }
    }
    return $settings
}
