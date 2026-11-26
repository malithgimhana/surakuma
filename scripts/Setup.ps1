#Requires -Version 7.4
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9_]{1,80}$')][string]$LocalDbInstance = 'MSSQLLocalDB',
    [ValidatePattern('^[A-Za-z0-9_]{1,100}$')][string]$Database,
    [switch]$Assessment
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Local-Configuration.ps1')

if (!$Database) {
    $Database = if ($Assessment) { "Surakuma_Assessment_$([Guid]::NewGuid().ToString('N'))" } else { 'Surakuma_Development' }
}
if ($Assessment.IsPresent -ne $Database.StartsWith('Surakuma_Assessment_', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Use -Assessment with a fresh Surakuma_Assessment_ database name, or omit -Database for an automatically generated name.'
}
$tools = Get-SurakumaTools
$settings = Get-SurakumaEnvironment $LocalDbInstance $Database $Assessment
$mode = '--setup'
if ($Assessment) {
    $mode = '--seed-assessment'
    $settings.Seed__Password = 'Sk!' + [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(16)) + 'a9'
}

Push-Location -LiteralPath $repo
try {
    & $tools.dotnet tool restore
    if ($LASTEXITCODE) { throw '.NET tool restore failed. Check access to the NuGet package feed.' }
    & $tools.dotnet restore backend/Surakuma.sln
    if ($LASTEXITCODE) { throw '.NET dependency restore failed.' }
    Push-Location -LiteralPath (Join-Path $repo 'frontend')
    try {
        & $tools['npm.cmd'] ci
        if ($LASTEXITCODE) { throw 'Frontend dependency installation failed. Check access to the npm registry.' }
    } finally { Pop-Location }

    & $tools.dotnet dev-certs https --check --quiet
    if ($LASTEXITCODE) {
        & $tools.dotnet dev-certs https
        if ($LASTEXITCODE) { throw 'Could not create the .NET HTTPS development certificate.' }
    }
    Start-SurakumaLocalDb $tools $LocalDbInstance

    $original = @{}
    try {
        foreach ($name in $settings.Keys) {
            $original[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
            if ($null -eq $settings[$name]) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
            else { Set-Item -LiteralPath "Env:$name" -Value $settings[$name] }
        }
        Write-Host "Setting up LocalDB instance $LocalDbInstance, database $Database."
        & $tools.dotnet run --project backend/src/Surakuma.Api --configuration Release --no-restore --no-launch-profile -- $mode
        if ($LASTEXITCODE) { throw 'Database setup failed. See the API output above.' }
    } finally {
        foreach ($name in $original.Keys) {
            if ($null -eq $original[$name]) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
            else { Set-Item -LiteralPath "Env:$name" -Value $original[$name] }
        }
    }
    Write-Host "Setup completed. Start with .\scripts\Start-Surakuma.ps1 -LocalDbInstance $LocalDbInstance -Database $Database"
    if ($Assessment) {
        Write-Host "Private assessment logins are in backend/data/assessment/$Database/ASSESSMENT-ACCESS-PRIVATE.md."
    }
} finally { Pop-Location }
