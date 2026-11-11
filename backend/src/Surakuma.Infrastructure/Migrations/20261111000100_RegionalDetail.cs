using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Surakuma.Infrastructure.Migrations;

[DbContext(typeof(CrisisDbContext))]
[Migration("20261111000100_RegionalDetail")]
public sealed class RegionalDetail : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        using var stream = typeof(RegionalDetail).Assembly.GetManifestResourceStream("Surakuma.Infrastructure.ReferenceData.regions-20261110.json") ?? throw new InvalidOperationException("Missing regional reference snapshot.");
        using var reader = new StreamReader(stream);
        var json = reader.ReadToEnd().Replace("'", "''");
        migrationBuilder.Sql($"""
            DECLARE @regions nvarchar(max) = N'{json}';
            SELECT * INTO #regions FROM OPENJSON(@regions) WITH (
                Id uniqueidentifier '$.id', CountryCode varchar(2) '$.country', Name nvarchar(4000) '$.name',
                LevelName nvarchar(4000) '$.level', ParentId uniqueidentifier '$.parentId', ParentName nvarchar(4000) '$.parentName');
            UPDATE r SET ParentId = d.Id FROM #regions r JOIN AdministrativeDivision d ON d.CountryCode = r.CountryCode AND d.Name = r.ParentName AND d.ParentId IS NULL WHERE r.ParentName IS NOT NULL;
            IF EXISTS (SELECT 1 FROM #regions WHERE ParentId IS NULL) THROW 51000, 'Unresolved regional reference parent.', 1;
            -- Insert the snapshot in two levels so foreign keys are satisfied without disabling them.
            INSERT AdministrativeDivision (Id,CountryCode,Name,LevelName,ParentId,CreatedAt,UpdatedAt)
            SELECT r.Id,r.CountryCode,r.Name,r.LevelName,r.ParentId,SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET() FROM #regions r
            WHERE r.ParentName IS NOT NULL AND NOT EXISTS (SELECT 1 FROM AdministrativeDivision d WHERE d.Id=r.Id);
            INSERT AdministrativeDivision (Id,CountryCode,Name,LevelName,ParentId,CreatedAt,UpdatedAt)
            SELECT r.Id,r.CountryCode,r.Name,r.LevelName,r.ParentId,SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET() FROM #regions r
            WHERE r.ParentName IS NULL AND NOT EXISTS (SELECT 1 FROM AdministrativeDivision d WHERE d.Id=r.Id);
            DROP TABLE #regions;
            """);
    }
    protected override void Down(MigrationBuilder migrationBuilder) => throw new InvalidOperationException("Regional reference data may be in operational use. Restore a reviewed backup instead of deleting regions.");
}
