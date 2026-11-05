$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'Package.ps1')
$items = @(
    @{ Path='output/Surakuma-source.zip'; Name='prototype/Surakuma-source.zip' },
    @{ Path='output/pdf/Surakuma-technical-report.pdf'; Name='report/Surakuma-technical-report.pdf' },
    @{ Path='output/docx/Surakuma-technical-report.docx'; Name='report/Surakuma-technical-report.docx' },
    @{ Path='output/demo/Surakuma-walkthrough.webm'; Name='demonstration/Surakuma-walkthrough.webm' },
    @{ Path='output/demo/index.html'; Name='demonstration/index.html' },
    @{ Path='output/demo/walkthrough-transcript.md'; Name='demonstration/walkthrough-transcript.md' },
    @{ Path='output/demo/recording-evidence.json'; Name='demonstration/recording-evidence.json' },
    @{ Path='output/demo/media-verification.json'; Name='demonstration/media-verification.json' },
    @{ Path='docs/submission/README.md'; Name='review/README.md' },
    @{ Path='docs/submission/translation-review.csv'; Name='review/translation-review.csv' },
    @{ Path='docs/submission/uat-review.md'; Name='review/uat-review.md' },
    @{ Path='docs/submission/contribution-record.csv'; Name='review/contribution-record.csv' },
    @{ Path='docs/submission/presentation-handover.md'; Name='review/presentation-handover.md' },
    @{ Path='README.md'; Name='SETUP.md' }
    @{ Path='docs/submission/package-overview.md'; Name='README.md' }
)
foreach ($item in $items) {
    $item.FullPath = Join-Path $projectRoot $item.Path
    if (!(Test-Path -LiteralPath $item.FullPath -PathType Leaf)) { throw "Required material missing: $($item.Path)" }
}
$archivePath = Join-Path $projectRoot 'output/Surakuma-assessment-package.zip'
$manifest = @('SURAKUMA ASSESSMENT PREPARATION PACKAGE', '', 'Identity fields are intentionally blank. Human translation/UAT approval and live provider validation remain pending.', 'The local recording uses synthetic data, AI fallback and email capture. No hosted viewing link is claimed.', '', 'SHA256  FILE')
$stream = [IO.File]::Open($archivePath, [IO.FileMode]::Create)
$zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($item in $items) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $item.FullPath, $item.Name, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        $manifest += "$( (Get-FileHash -LiteralPath $item.FullPath -Algorithm SHA256).Hash )  $($item.Name)"
    }
    $entry = $zip.CreateEntry('PACKAGE-MANIFEST.txt')
    $writer = [IO.StreamWriter]::new($entry.Open())
    try { $writer.Write(($manifest -join [Environment]::NewLine)) } finally { $writer.Dispose() }
} finally { $zip.Dispose(); $stream.Dispose() }
Write-Output "Created combined assessment package: $archivePath"
