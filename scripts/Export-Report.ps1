param(
    [string]$InputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'output/docx/Surakuma-technical-report.docx'),
    [string]$OutputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'output/pdf/Surakuma-technical-report.pdf')
)
$ErrorActionPreference = 'Stop'
$inputDocument = (Resolve-Path -LiteralPath $InputPath).Path
$outputDocument = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outputDocument) | Out-Null
$reportWord = $null
$reportDocument = $null
try {
    # A dedicated hidden instance; do not attach to or close a user's open Word session.
    $reportWord = New-Object -ComObject Word.Application
    $reportWord.Visible = $false
    $reportWord.DisplayAlerts = 0
    $reportWord.AutomationSecurity = 3
    $reportDocument = $reportWord.Documents.Open($inputDocument, $false, $true, $false)
    $reportDocument.Repaginate()
    $reportDocument.ExportAsFixedFormat($outputDocument, 17)
    Write-Output "Exported report PDF: $outputDocument"
} finally {
    if ($null -ne $reportDocument) { $reportDocument.Close(0); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($reportDocument) }
    if ($null -ne $reportWord) { $reportWord.Quit(0); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($reportWord) }
}
