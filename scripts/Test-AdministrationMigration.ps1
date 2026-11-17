param([switch]$ApplyLive)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$folder = Join-Path $repo "tmp/administration-rollout/$stamp"
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$server = '(localdb)\MSSQLLocalDB'
$baseline = "Surakuma_AdminBaseline_$($stamp.Replace('-',''))"
$rehearsal = "Surakuma_AdminRehearsal_$($stamp.Replace('-',''))"
$backup = Join-Path $folder 'Surakuma-before-administration.bak'
function Query([string]$sql) { & sqlcmd -I -S $server -E -b -Q $sql; if ($LASTEXITCODE) { throw 'SQL operation failed.' } }
Query "BACKUP DATABASE [Surakuma] TO DISK = N'$backup' WITH COPY_ONLY, CHECKSUM; RESTORE VERIFYONLY FROM DISK = N'$backup' WITH CHECKSUM;"
$logical = & sqlcmd -I -S $server -E -h -1 -W -Q "SET NOCOUNT ON; SELECT name FROM sys.master_files WHERE database_id=DB_ID('Surakuma') ORDER BY type;"
$logical = @($logical | Where-Object { $_.Trim() })
if ($logical.Count -ne 2) { throw 'Expected one data and one log file; inspect the backup before restore.' }
foreach ($name in @($baseline,$rehearsal)) {
    $dataFile = Join-Path $folder "$name.mdf"
    $logFile = Join-Path $folder "$name.ldf"
    Query "RESTORE DATABASE [$name] FROM DISK=N'$backup' WITH MOVE N'$($logical[0])' TO N'$dataFile', MOVE N'$($logical[1])' TO N'$logFile', RECOVERY;"
}
& sqlcmd -I -S $server -E -b -d $rehearsal -i (Join-Path $repo 'tmp/administration-migration.sql') -o (Join-Path $folder 'rehearsal-migration.log')
if ($LASTEXITCODE) { throw 'Rehearsal migration failed.' }
$compare = @"
SET NOCOUNT ON;
DECLARE @table sysname, @columns nvarchar(max), @query nvarchar(max);
CREATE TABLE #results (TableName sysname, SourceRows bigint, CopyRows bigint, MissingOrChanged bigint);
DECLARE originals CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM [$baseline].sys.tables WHERE schema_id=1 AND name <> '__EFMigrationsHistory';
OPEN originals; FETCH NEXT FROM originals INTO @table;
WHILE @@FETCH_STATUS=0 BEGIN
 SELECT @columns=STRING_AGG(CONVERT(nvarchar(max),QUOTENAME(c.name)),',') WITHIN GROUP(ORDER BY c.column_id) FROM [$baseline].sys.columns c JOIN [$baseline].sys.tables t ON t.object_id=c.object_id WHERE t.name=@table AND t.schema_id=1 AND c.name <> 'Version';
 SET @query=N'INSERT #results SELECT N'''+REPLACE(@table,'''','''''')+N''',(SELECT COUNT_BIG(*) FROM [$baseline].dbo.'+QUOTENAME(@table)+N'),(SELECT COUNT_BIG(*) FROM [$rehearsal].dbo.'+QUOTENAME(@table)+N'),(SELECT COUNT_BIG(*) FROM (SELECT '+@columns+N' FROM [$baseline].dbo.'+QUOTENAME(@table)+N' EXCEPT SELECT '+@columns+N' FROM [$rehearsal].dbo.'+QUOTENAME(@table)+N') d);';
 EXEC sp_executesql @query; FETCH NEXT FROM originals INTO @table;
END; CLOSE originals; DEALLOCATE originals;
SELECT * FROM #results ORDER BY TableName;
IF EXISTS(SELECT 1 FROM #results WHERE MissingOrChanged<>0 OR SourceRows<>CopyRows) THROW 51000,'Migration changed original data.',1;
IF EXISTS(SELECT 1 FROM [$rehearsal].dbo.OrganisationCountry WHERE VerificationState<>'LegacyActive') THROW 51000,'Legacy partners were not preserved.',1;
"@
$compare | Set-Content (Join-Path $folder 'verify.sql')
& sqlcmd -I -S $server -E -b -i (Join-Path $folder 'verify.sql') -o (Join-Path $folder 'verification.txt')
if ($LASTEXITCODE) { throw 'Record comparison failed.' }
if ($ApplyLive) {
    & sqlcmd -I -S $server -E -b -d Surakuma -i (Join-Path $repo 'tmp/administration-migration.sql') -o (Join-Path $folder 'live-migration.log')
    if ($LASTEXITCODE) { throw 'Live migration failed.' }
}
Write-Output "Verified backup and rehearsal: $folder"
Write-Output "Rehearsal database: $rehearsal"
