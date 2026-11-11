-- Run on LocalDB after restoring a COPY_ONLY backup and migrating only the rehearsal database.
SET NOCOUNT ON;
DECLARE @table sysname, @columns nvarchar(max), @query nvarchar(max);
CREATE TABLE #results (TableName sysname, SourceRows bigint, CopyRows bigint, MissingOrChanged bigint);
DECLARE originals CURSOR LOCAL FAST_FORWARD FOR
 SELECT name FROM Surakuma_InternationalBaseline_20261110.sys.tables WHERE schema_id = 1 AND name <> '__EFMigrationsHistory';
OPEN originals;
FETCH NEXT FROM originals INTO @table;
WHILE @@FETCH_STATUS = 0
BEGIN
 SELECT @columns = STRING_AGG(CONVERT(nvarchar(max), QUOTENAME(c.name)), ',') WITHIN GROUP (ORDER BY c.column_id)
 FROM Surakuma_InternationalBaseline_20261110.sys.columns c JOIN Surakuma_InternationalBaseline_20261110.sys.tables t ON t.object_id=c.object_id WHERE t.name=@table AND t.schema_id=1;
 SET @query = N'INSERT #results SELECT N''' + REPLACE(@table,'''','''''') + N''',
 (SELECT COUNT_BIG(*) FROM Surakuma_InternationalBaseline_20261110.dbo.'+QUOTENAME(@table)+N'),
 (SELECT COUNT_BIG(*) FROM Surakuma_InternationalRehearsal_20261110.dbo.'+QUOTENAME(@table)+N'),
 (SELECT COUNT_BIG(*) FROM (SELECT '+@columns+N' FROM Surakuma_InternationalBaseline_20261110.dbo.'+QUOTENAME(@table)+N' EXCEPT SELECT '+@columns+N' FROM Surakuma_InternationalRehearsal_20261110.dbo.'+QUOTENAME(@table)+N') d);';
 EXEC sp_executesql @query;
 FETCH NEXT FROM originals INTO @table;
END;
CLOSE originals;
DEALLOCATE originals;
SELECT * FROM #results ORDER BY TableName;
IF EXISTS (SELECT 1 FROM #results WHERE MissingOrChanged <> 0 OR (TableName <> 'AspNetRoles' AND SourceRows <> CopyRows)) THROW 51000, 'Migration changed existing records.', 1;
IF EXISTS (SELECT 1 FROM Surakuma_InternationalRehearsal_20261110.dbo.Crisis WHERE CountryCode <> 'LK') THROW 51000, 'Unexpected legacy country.', 1;
SELECT CountryCode, COUNT(*) AS Regions FROM Surakuma_InternationalRehearsal_20261110.dbo.AdministrativeDivision GROUP BY CountryCode;
SELECT MigrationId AS SourceMigration FROM Surakuma_InternationalBaseline_20261110.dbo.__EFMigrationsHistory ORDER BY MigrationId;
