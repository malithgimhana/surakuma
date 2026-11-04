param([string]$SqlServer = '.\SQLEXPRESS')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    $env:DOTNET_CLI_HOME = Join-Path $projectRoot 'tmp\dotnet-home'
    $env:NUGET_PACKAGES = Join-Path $projectRoot 'tmp\nuget'
    $env:MSBUILDTERMINALLOGGER = 'off'
    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    $env:ConnectionStrings__Default = "Server=$SqlServer;Database=Surakuma;Trusted_Connection=True;TrustServerCertificate=True;Connect Timeout=10"
    dotnet tool restore
    if ($LASTEXITCODE -ne 0) { throw 'EF tool restore failed.' }
    dotnet restore backend/Surakuma.sln
    if ($LASTEXITCODE -ne 0) { throw '.NET restore failed.' }
    Push-Location frontend
    try { npm ci; if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' } } finally { Pop-Location }
    dotnet run --project backend/src/Surakuma.Api -- --migrate
    if ($LASTEXITCODE -ne 0) { throw 'Database migration or seeding failed. Check SQL Server and Windows authentication.' }
    Write-Host 'Setup complete. Development-only credentials are in backend/data/development-settings.json (ignored by Git).'
    Write-Host 'Run scripts/Start-Api.ps1 and scripts/Start-Web.ps1 in separate terminals.'
    if ($SqlServer -ne '.\SQLEXPRESS') { Write-Host 'Set ConnectionStrings__Default in the API terminal to use this custom SQL instance.' }
} finally { Pop-Location }
