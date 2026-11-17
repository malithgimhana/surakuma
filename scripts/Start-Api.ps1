param([switch]$BrowserTests)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env'
$previousMappingKey = $env:Mapping__ApiKey
Push-Location $projectRoot
try {
    if ([string]::IsNullOrWhiteSpace($previousMappingKey) -and (Test-Path -LiteralPath $envFile -PathType Leaf)) {
        $mappingEntry = Select-String -LiteralPath $envFile -Pattern '^\s*Mapping__ApiKey\s*=\s*(.*?)\s*$' | Select-Object -Last 1
        if ($mappingEntry) {
            $env:Mapping__ApiKey = $mappingEntry.Matches[0].Groups[1].Value.Trim([char[]]@('"', "'"))
        }
    }

    $env:DOTNET_CLI_HOME = Join-Path $projectRoot 'tmp\dotnet-home'
    $env:NUGET_PACKAGES = Join-Path $projectRoot 'tmp\nuget'
    $env:MSBUILDTERMINALLOGGER = 'off'
    $previousAuthLimit = $env:RateLimits__AuthPermitLimit
    # Browser acceptance switches several synthetic roles in one minute.
    # Keep the normal application limit unchanged outside an explicit test run.
    if ($BrowserTests) { $env:RateLimits__AuthPermitLimit = '1000' }
    dotnet run --project backend/src/Surakuma.Api
} finally {
    $env:Mapping__ApiKey = $previousMappingKey
    if ($BrowserTests) { $env:RateLimits__AuthPermitLimit = $previousAuthLimit }
    Pop-Location
}
