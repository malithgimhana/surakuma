$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectRoot 'output'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$archivePath = Join-Path $outputDirectory 'Surakuma-source.zip'
$excluded = @('node_modules','dist','bin','obj','data','test-results','playwright-report','coverage','.git','tmp')
$sourceFiles = [System.Collections.Generic.List[string]]::new()
foreach ($name in @('.gitignore','.editorconfig','README.md')) { $sourceFiles.Add((Join-Path $projectRoot $name)) }
foreach ($name in @('frontend','backend','database','docs','scripts','.config')) {
    $stack = [System.Collections.Generic.Stack[string]]::new()
    $stack.Push((Join-Path $projectRoot $name))
    while ($stack.Count -gt 0) {
        foreach ($entry in Get-ChildItem -LiteralPath $stack.Pop() -Force) {
            if ($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { continue }
            if ($entry.PSIsContainer) { if ($entry.Name -notin $excluded) { $stack.Push($entry.FullName) }; continue }
            if ($entry.Name.StartsWith('.env') -and $entry.Name -ne '.env.example') { continue }
            if ($entry.Extension -in @('.log','.user','.suo','.tsbuildinfo')) { continue }
            $sourceFiles.Add($entry.FullName)
        }
    }
}
$stream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::Create)
$zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $sourceFiles) {
        $relativePath = [System.IO.Path]::GetRelativePath($projectRoot, $file).Replace('\','/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file, $relativePath, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $zip.Dispose(); $stream.Dispose() }
Write-Host "Packaged $($sourceFiles.Count) source/documentation files: $archivePath"
