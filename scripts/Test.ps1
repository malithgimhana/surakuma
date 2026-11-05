$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    $env:DOTNET_CLI_HOME = Join-Path $projectRoot 'tmp\dotnet-home'
    $env:NUGET_PACKAGES = Join-Path $projectRoot 'tmp\nuget'
    $env:MSBUILDTERMINALLOGGER = 'off'
    dotnet test backend/Surakuma.sln --verbosity minimal
    if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed.' }
    Push-Location frontend
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
        npm test
        if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed.' }
    } finally { Pop-Location }
} finally { Pop-Location }
