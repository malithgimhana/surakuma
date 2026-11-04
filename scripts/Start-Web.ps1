$ErrorActionPreference = 'Stop'
Push-Location (Join-Path (Split-Path -Parent $PSScriptRoot) 'frontend')
try { npm run dev -- --host localhost } finally { Pop-Location }
