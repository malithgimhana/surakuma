param([switch]$BrowserTests, [switch]$Restart)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$launchSettings = Get-Content -LiteralPath (Join-Path $projectRoot 'backend/src/Surakuma.Api/Properties/launchSettings.json') | ConvertFrom-Json
$apiAddresses = $launchSettings.profiles.https.applicationUrl -split ';'
$apiPorts = @($apiAddresses | ForEach-Object { ([uri]$_).Port })
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $apiPorts })
if ($listeners.Count -gt 0) {
    $expectedApiPath = [IO.Path]::GetFullPath((Join-Path $projectRoot 'backend/src/Surakuma.Api/bin/Debug/net10.0/Surakuma.Api.exe'))
    $runningApis = @()
    foreach ($listenerProcessId in @($listeners.OwningProcess | Select-Object -Unique)) {
        $runningApi = Get-Process -Id $listenerProcessId -ErrorAction Stop
        if ($runningApi.Path -ne $expectedApiPath) {
            throw "API port is occupied by another process (PID $listenerProcessId). Stop that process or change the API launch/proxy settings. No process was stopped."
        }
        $runningApis += $runningApi
    }
    if (-not $Restart) {
        Write-Host "Surakuma API is already running (PID $($runningApis.Id -join ', '))."
        Write-Host "API: $($apiAddresses -join ' | ')"
        Write-Host 'To restart it and load source changes, run: .\scripts\Start-Api.ps1 -Restart'
        if ($BrowserTests) {
            Write-Host 'Use -Restart -BrowserTests to apply the browser-test rate limits.'
        }
        return
    }
    foreach ($runningApi in $runningApis) {
        Write-Host "Stopping this workspace's API (PID $($runningApi.Id))..."
        Stop-Process -Id $runningApi.Id
        $runningApi.WaitForExit(10000) | Out-Null
        if (-not $runningApi.HasExited) { throw 'The existing API did not stop. Try again after it exits.' }
    }
}
$envFile = Join-Path $projectRoot '.env'
$previousMappingKey = $env:Mapping__ApiKey
$previousAuthLimit = $env:RateLimits__AuthPermitLimit
Push-Location $projectRoot
try {
    if ([string]::IsNullOrWhiteSpace($previousMappingKey) -and (Test-Path -LiteralPath $envFile -PathType Leaf)) {
        $mappingEntry = Select-String -LiteralPath $envFile -Pattern '^\s*Mapping__ApiKey\s*=\s*(.*?)\s*$' | Select-Object -Last 1
        if ($mappingEntry) {
            $env:Mapping__ApiKey = $mappingEntry.Matches[0].Groups[1].Value.Trim([char[]]@('"', "'"))
        }
    }

    # Browser acceptance switches several synthetic roles in one minute.
    # Keep the normal application limit unchanged outside an explicit test run.
    if ($BrowserTests) { $env:RateLimits__AuthPermitLimit = '1000' }
    dotnet run --project backend/src/Surakuma.Api
    if ($LASTEXITCODE -ne 0) { throw "API exited with code $LASTEXITCODE." }
} finally {
    $env:Mapping__ApiKey = $previousMappingKey
    if ($BrowserTests) { $env:RateLimits__AuthPermitLimit = $previousAuthLimit }
    Pop-Location
}
