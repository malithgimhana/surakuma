using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations;

[DbContext(typeof(CrisisDbContext))]
[Migration("20261117120000_DefaultAlertLanguages")]
public sealed class DefaultAlertLanguages : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) =>
        ChangeDefaults(migrationBuilder, "'en'", "'en,hi'", "'en,ne'");

    protected override void Down(MigrationBuilder migrationBuilder) =>
        ChangeDefaults(migrationBuilder, "CASE c.[Code] WHEN 'IN' THEN 'en,hi' ELSE 'en,ne' END", "'en'", "'en'");

    private static void ChangeDefaults(MigrationBuilder migrationBuilder, string previous, string india, string nepal) =>
        migrationBuilder.Sql($"""
            UPDATE c SET [RequiredAlertLanguages] = CASE c.[Code] WHEN 'IN' THEN {india} ELSE {nepal} END
            FROM [Country] c
            WHERE ((c.[Code] = 'IN' AND c.[Languages] = 'en,hi,ta') OR (c.[Code] = 'NP' AND c.[Languages] = 'en,ne'))
                AND c.[RequiredAlertLanguages] = {previous}
                AND NOT EXISTS (SELECT 1 FROM [AuditEvent] a WHERE a.[EntityId] = c.[Id]
                    AND a.[Action] = 'CountryServicesConfigured'
                    AND a.[Detail] LIKE '%Required alert languages changed%');
            """);
}
