param([switch]$BrowserTests)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    $env:DOTNET_CLI_HOME = Join-Path $projectRoot 'tmp\dotnet-home'
    $env:NUGET_PACKAGES = Join-Path $projectRoot 'tmp\nuget'
    $env:MSBUILDTERMINALLOGGER = 'off'
    $previousAuthLimit = $env:RateLimits__AuthPermitLimit
    # Browser acceptance switches several synthetic roles in one minute.
    # Keep the normal application limit unchanged outside an explicit test run.
    if ($BrowserTests) { $env:RateLimits__AuthPermitLimit = '1000' }
    dotnet run --project backend/src/Surakuma.Api
} finally {
    if ($BrowserTests) { $env:RateLimits__AuthPermitLimit = $previousAuthLimit }
    Pop-Location
}
