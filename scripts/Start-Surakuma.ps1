#Requires -Version 7.4
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9_]{1,80}$')][string]$LocalDbInstance = 'MSSQLLocalDB',
    [ValidatePattern('^[A-Za-z0-9_]{1,100}$')][string]$Database = 'Surakuma_Development',
    [ValidateRange(1024, 65535)][int]$ApiPort = 7043,
    [ValidateRange(1024, 65535)][int]$WebPort = 5173,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Local-Configuration.ps1')
if ($ApiPort -eq $WebPort) { throw 'Choose different API and web ports.' }
$listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
foreach ($port in @($ApiPort, $WebPort)) {
    if ($port -in $listeners.Port) { throw "Port $port is already in use. Choose another port with -ApiPort or -WebPort." }
}

$tools = Get-SurakumaTools
$assessment = $Database.StartsWith('Surakuma_Assessment_', [StringComparison]::OrdinalIgnoreCase)
$apiSettings = Get-SurakumaEnvironment $LocalDbInstance $Database $assessment
if ($assessment -and !(Test-Path -LiteralPath (Join-Path $apiSettings.Storage__DevelopmentDataPath 'ASSESSMENT-ACCESS-PRIVATE.md') -PathType Leaf)) {
    throw 'Assessment logins are missing from this checkout. Use the database name printed by Setup.ps1 -Assessment.'
}
$api = Join-Path $repo 'backend/src/Surakuma.Api'
$frontend = Join-Path $repo 'frontend'
if (!(Test-Path -LiteralPath (Join-Path $frontend 'node_modules/vite/bin/vite.js'))) {
    throw 'Frontend dependencies are missing. Run Setup.ps1 first.'
}
Start-SurakumaLocalDb $tools $LocalDbInstance
& $tools.dotnet build $api --configuration Release --no-restore
if ($LASTEXITCODE) { throw 'API build failed. Run Setup.ps1 if .NET dependencies have not been restored.' }

$apiUrl = "https://localhost:$ApiPort"
$webUrl = "http://localhost:$WebPort"
$apiSettings.ASPNETCORE_URLS = $apiUrl
$apiSettings.Cors__Origins__0 = $webUrl
$apiSettings.Cors__Origins__1 = "http://127.0.0.1:$WebPort"
if ($assessment) { $apiSettings.Email__PortalBaseUrl = $webUrl }
$webSettings = @{ SURAKUMA_API_PROXY = $apiUrl; VITE_API_URL = '/api/v1' }
$logs = Join-Path $repo "tmp/startup/$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $logs | Out-Null
$apiProcess = $null
$webProcess = $null

function Wait-SurakumaReady([Diagnostics.Process]$Process, [string]$Url, [string]$ExpectedStatus) {
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        if ($Process.HasExited) { throw "$Url exited before it was ready. See $logs." }
        try {
            $response = Invoke-WebRequest -Uri $Url -SkipCertificateCheck -TimeoutSec 3
            if ($response.StatusCode -eq 200 -and
                (!$ExpectedStatus -or ($response.Content | ConvertFrom-Json).status -eq $ExpectedStatus)) { return }
        } catch { }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "$Url did not become ready. Check the selected database and logs in $logs."
}

try {
    $dll = Join-Path $api 'bin/Release/net10.0/Surakuma.Api.dll'
    $apiProcess = Start-Process -FilePath $tools.dotnet -ArgumentList "`"$dll`"" -WorkingDirectory $api -Environment $apiSettings -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'api.log') -RedirectStandardError (Join-Path $logs 'api-error.log')
    Wait-SurakumaReady $apiProcess "$apiUrl/api/v1/ready" 'ready'
    $webProcess = Start-Process -FilePath $tools.node -ArgumentList @('node_modules/vite/bin/vite.js', '--host', 'localhost', '--port', $WebPort, '--strictPort') -WorkingDirectory $frontend -Environment $webSettings -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'web.log') -RedirectStandardError (Join-Path $logs 'web-error.log')
    Wait-SurakumaReady $webProcess $webUrl ''
    Wait-SurakumaReady $webProcess "$webUrl/api/v1/ready" 'ready'

    Write-Host "Surakuma is ready on LocalDB database $Database."
    Write-Host "Website: $webUrl"
    Write-Host "Swagger: $apiUrl/swagger"
    Write-Host "API readiness: $apiUrl/api/v1/ready"
    Write-Host "Logs: $logs"
    if (!$CheckOnly) {
        Write-Host 'Press Ctrl+C in this terminal to stop both services.'
        while (!$apiProcess.HasExited -and !$webProcess.HasExited) { Start-Sleep -Seconds 1 }
        throw "A Surakuma service exited. See $logs."
    }
} finally {
    foreach ($process in @($webProcess, $apiProcess)) {
        if ($process -and !$process.HasExited) { $process.Kill($true); $process.WaitForExit() }
    }
}
