using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AdministratorScopes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ArchivedAt",
                table: "OrganisationCountry",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "OrganisationId",
                table: "Membership",
                type: "uniqueidentifier",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uniqueidentifier");

            migrationBuilder.AddColumn<bool>(
                name: "IsSystemAdministrator",
                table: "AspNetUsers",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.Sql("""
                EXEC(N'UPDATE account
                SET IsSystemAdministrator = 1
                FROM AspNetUsers account
                WHERE EXISTS (
                    SELECT 1 FROM Membership grantRow
                    JOIN Organisation partner ON partner.Id = grantRow.OrganisationId
                    WHERE grantRow.UserId = account.Id AND grantRow.Role = N''Administrator''
                      AND grantRow.Suspended = 0 AND partner.ArchivedAt IS NULL
                );');

                -- Keep one country-wide grant per account and country, preferring active grants.
                WITH countryGrants AS (
                    SELECT grantRow.Id, ROW_NUMBER() OVER (
                        PARTITION BY grantRow.UserId, grantRow.CountryCode
                        ORDER BY CASE WHEN grantRow.Suspended = 0 AND partner.ArchivedAt IS NULL THEN 0 ELSE 1 END,
                                 grantRow.CreatedAt, grantRow.Id
                    ) AS GrantOrder
                    FROM Membership grantRow
                    JOIN Organisation partner ON partner.Id = grantRow.OrganisationId
                    WHERE grantRow.Role = N'CountryAdministrator'
                )
                DELETE grantRow FROM Membership grantRow
                JOIN countryGrants ranked ON ranked.Id = grantRow.Id
                WHERE ranked.GrantOrder > 1;

                UPDATE grantRow
                SET OrganisationId = NULL, CrisisId = NULL,
                    Suspended = CASE WHEN partner.ArchivedAt IS NOT NULL THEN 1 ELSE grantRow.Suspended END
                FROM Membership grantRow
                JOIN Organisation partner ON partner.Id = grantRow.OrganisationId
                WHERE grantRow.Role = N'CountryAdministrator';

                -- Old requests specified a partner. Get fresh approval for the account-wide role.
                UPDATE AdminProposal
                SET State = N'Stale', DecisionReason = N'Submit a fresh request for organisation-independent system administrator access.'
                WHERE Kind = N'GlobalAccess' AND State = N'Pending';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM Membership WHERE OrganisationId IS NULL)
                    OR EXISTS (SELECT 1 FROM OrganisationCountry WHERE ArchivedAt IS NOT NULL)
                    OR EXISTS (SELECT 1 FROM AspNetUsers WHERE IsSystemAdministrator = 1)
                    THROW 51000, 'Restore the pre-upgrade backup to roll back administrator scopes.', 1;
                """);
            migrationBuilder.DropColumn(
                name: "ArchivedAt",
                table: "OrganisationCountry");

            migrationBuilder.DropColumn(
                name: "IsSystemAdministrator",
                table: "AspNetUsers");

            migrationBuilder.AlterColumn<Guid>(
                name: "OrganisationId",
                table: "Membership",
                type: "uniqueidentifier",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uniqueidentifier",
                oldNullable: true);
        }
    }
}
