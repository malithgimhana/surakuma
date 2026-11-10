using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InternationalGeography : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "AdministrativeDivisionId",
                table: "Shelter",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CountryCode",
                table: "Shelter",
                type: "varchar(2)",
                unicode: false,
                maxLength: 2,
                nullable: false,
                defaultValue: "LK");

            migrationBuilder.AddColumn<Guid>(
                name: "AdministrativeDivisionId",
                table: "Resource",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CountryCode",
                table: "Resource",
                type: "varchar(2)",
                unicode: false,
                maxLength: 2,
                nullable: false,
                defaultValue: "LK");

            migrationBuilder.AddColumn<Guid>(
                name: "AdministrativeDivisionId",
                table: "Crisis",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CountryCode",
                table: "Crisis",
                type: "varchar(2)",
                unicode: false,
                maxLength: 2,
                nullable: false,
                defaultValue: "LK");

            migrationBuilder.AddColumn<Guid>(
                name: "InternationalIncidentId",
                table: "Crisis",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Country",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Code = table.Column<string>(type: "varchar(2)", unicode: false, maxLength: 2, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Country", x => x.Id);
                    table.UniqueConstraint("AK_Country_Code", x => x.Code);
                });

            // Reference rows must exist before adding country foreign keys to legacy records.
            migrationBuilder.Sql(@"INSERT INTO [Country] ([Id], [Code], [Name], [CreatedAt], [UpdatedAt])
                VALUES (NEWID(), 'LK', N'Sri Lanka', SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET()),
                       (NEWID(), 'NP', N'Nepal', SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET()),
                       (NEWID(), 'IN', N'India', SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET());");

            migrationBuilder.CreateTable(
                name: "InternationalIncident",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InternationalIncident", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "AdministrativeDivision",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CountryCode = table.Column<string>(type: "varchar(2)", unicode: false, maxLength: 2, nullable: false, defaultValue: "LK"),
                    ParentId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Name = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    LevelName = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AdministrativeDivision", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AdministrativeDivision_AdministrativeDivision_ParentId",
                        column: x => x.ParentId,
                        principalTable: "AdministrativeDivision",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AdministrativeDivision_Country_CountryCode",
                        column: x => x.CountryCode,
                        principalTable: "Country",
                        principalColumn: "Code",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OrganisationCountry",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CountryCode = table.Column<string>(type: "varchar(2)", unicode: false, maxLength: 2, nullable: false, defaultValue: "LK"),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrganisationCountry", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OrganisationCountry_Country_CountryCode",
                        column: x => x.CountryCode,
                        principalTable: "Country",
                        principalColumn: "Code",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OrganisationCountry_Organisation_OrganisationId",
                        column: x => x.OrganisationId,
                        principalTable: "Organisation",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Shelter_AdministrativeDivisionId",
                table: "Shelter",
                column: "AdministrativeDivisionId");

            migrationBuilder.Sql(@"INSERT INTO [OrganisationCountry] ([Id], [OrganisationId], [CountryCode], [CreatedAt], [UpdatedAt])
                SELECT NEWID(), [Id], 'LK', SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET() FROM [Organisation];");

            migrationBuilder.CreateIndex(
                name: "IX_Shelter_CountryCode",
                table: "Shelter",
                column: "CountryCode");

            migrationBuilder.CreateIndex(
                name: "IX_Resource_AdministrativeDivisionId",
                table: "Resource",
                column: "AdministrativeDivisionId");

            migrationBuilder.CreateIndex(
                name: "IX_Resource_CountryCode",
                table: "Resource",
                column: "CountryCode");

            migrationBuilder.CreateIndex(
                name: "IX_Crisis_AdministrativeDivisionId",
                table: "Crisis",
                column: "AdministrativeDivisionId");

            migrationBuilder.CreateIndex(
                name: "IX_Crisis_CountryCode",
                table: "Crisis",
                column: "CountryCode");

            migrationBuilder.CreateIndex(
                name: "IX_Crisis_InternationalIncidentId",
                table: "Crisis",
                column: "InternationalIncidentId");

            migrationBuilder.CreateIndex(
                name: "IX_AdministrativeDivision_CountryCode",
                table: "AdministrativeDivision",
                column: "CountryCode");

            migrationBuilder.CreateIndex(
                name: "IX_AdministrativeDivision_ParentId",
                table: "AdministrativeDivision",
                column: "ParentId");

            migrationBuilder.CreateIndex(
                name: "IX_OrganisationCountry_CountryCode",
                table: "OrganisationCountry",
                column: "CountryCode");

            migrationBuilder.CreateIndex(
                name: "IX_OrganisationCountry_OrganisationId_CountryCode",
                table: "OrganisationCountry",
                columns: new[] { "OrganisationId", "CountryCode" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Crisis_AdministrativeDivision_AdministrativeDivisionId",
                table: "Crisis",
                column: "AdministrativeDivisionId",
                principalTable: "AdministrativeDivision",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Crisis_Country_CountryCode",
                table: "Crisis",
                column: "CountryCode",
                principalTable: "Country",
                principalColumn: "Code",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Crisis_InternationalIncident_InternationalIncidentId",
                table: "Crisis",
                column: "InternationalIncidentId",
                principalTable: "InternationalIncident",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Resource_AdministrativeDivision_AdministrativeDivisionId",
                table: "Resource",
                column: "AdministrativeDivisionId",
                principalTable: "AdministrativeDivision",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Resource_Country_CountryCode",
                table: "Resource",
                column: "CountryCode",
                principalTable: "Country",
                principalColumn: "Code",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Shelter_AdministrativeDivision_AdministrativeDivisionId",
                table: "Shelter",
                column: "AdministrativeDivisionId",
                principalTable: "AdministrativeDivision",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Shelter_Country_CountryCode",
                table: "Shelter",
                column: "CountryCode",
                principalTable: "Country",
                principalColumn: "Code",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"IF EXISTS (SELECT 1 FROM [Crisis] WHERE [CountryCode] <> 'LK' OR [InternationalIncidentId] IS NOT NULL OR [AdministrativeDivisionId] IS NOT NULL)
                OR EXISTS (SELECT 1 FROM [Resource] WHERE [CountryCode] <> 'LK' OR [AdministrativeDivisionId] IS NOT NULL)
                OR EXISTS (SELECT 1 FROM [Shelter] WHERE [CountryCode] <> 'LK' OR [AdministrativeDivisionId] IS NOT NULL)
                OR EXISTS (SELECT 1 FROM [OrganisationCountry] WHERE [CountryCode] <> 'LK')
                OR EXISTS (SELECT 1 FROM [AdministrativeDivision]) OR EXISTS (SELECT 1 FROM [InternationalIncident])
                THROW 51000, 'International geography is in use; rollback would discard data.', 1;");
            migrationBuilder.DropForeignKey(
                name: "FK_Crisis_AdministrativeDivision_AdministrativeDivisionId",
                table: "Crisis");

            migrationBuilder.DropForeignKey(
                name: "FK_Crisis_Country_CountryCode",
                table: "Crisis");

            migrationBuilder.DropForeignKey(
                name: "FK_Crisis_InternationalIncident_InternationalIncidentId",
                table: "Crisis");

            migrationBuilder.DropForeignKey(
                name: "FK_Resource_AdministrativeDivision_AdministrativeDivisionId",
                table: "Resource");

            migrationBuilder.DropForeignKey(
                name: "FK_Resource_Country_CountryCode",
                table: "Resource");

            migrationBuilder.DropForeignKey(
                name: "FK_Shelter_AdministrativeDivision_AdministrativeDivisionId",
                table: "Shelter");

            migrationBuilder.DropForeignKey(
                name: "FK_Shelter_Country_CountryCode",
                table: "Shelter");

            migrationBuilder.DropTable(
                name: "AdministrativeDivision");

            migrationBuilder.DropTable(
                name: "InternationalIncident");

            migrationBuilder.DropTable(
                name: "OrganisationCountry");

            migrationBuilder.DropTable(
                name: "Country");

            migrationBuilder.DropIndex(
                name: "IX_Shelter_AdministrativeDivisionId",
                table: "Shelter");

            migrationBuilder.DropIndex(
                name: "IX_Shelter_CountryCode",
                table: "Shelter");

            migrationBuilder.DropIndex(
                name: "IX_Resource_AdministrativeDivisionId",
                table: "Resource");

            migrationBuilder.DropIndex(
                name: "IX_Resource_CountryCode",
                table: "Resource");

            migrationBuilder.DropIndex(
                name: "IX_Crisis_AdministrativeDivisionId",
                table: "Crisis");

            migrationBuilder.DropIndex(
                name: "IX_Crisis_CountryCode",
                table: "Crisis");

            migrationBuilder.DropIndex(
                name: "IX_Crisis_InternationalIncidentId",
                table: "Crisis");

            migrationBuilder.DropColumn(
                name: "AdministrativeDivisionId",
                table: "Shelter");

            migrationBuilder.DropColumn(
                name: "CountryCode",
                table: "Shelter");

            migrationBuilder.DropColumn(
                name: "AdministrativeDivisionId",
                table: "Resource");

            migrationBuilder.DropColumn(
                name: "CountryCode",
                table: "Resource");

            migrationBuilder.DropColumn(
                name: "AdministrativeDivisionId",
                table: "Crisis");

            migrationBuilder.DropColumn(
                name: "CountryCode",
                table: "Crisis");

            migrationBuilder.DropColumn(
                name: "InternationalIncidentId",
                table: "Crisis");
        }
    }
}
