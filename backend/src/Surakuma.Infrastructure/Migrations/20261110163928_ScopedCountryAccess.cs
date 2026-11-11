using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ScopedCountryAccess : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF NOT EXISTS (SELECT 1 FROM [AspNetRoles] WHERE [NormalizedName] = 'COUNTRYADMINISTRATOR') INSERT INTO [AspNetRoles] ([Id], [Name], [NormalizedName], [ConcurrencyStamp]) VALUES (CONVERT(nvarchar(450), NEWID()), 'CountryAdministrator', 'COUNTRYADMINISTRATOR', CONVERT(nvarchar(450), NEWID()));");
            migrationBuilder.DropForeignKey(
                name: "FK_AdministrativeDivision_AdministrativeDivision_ParentId",
                table: "AdministrativeDivision");

            migrationBuilder.DropForeignKey(
                name: "FK_Crisis_AdministrativeDivision_AdministrativeDivisionId",
                table: "Crisis");

            migrationBuilder.DropForeignKey(
                name: "FK_Resource_AdministrativeDivision_AdministrativeDivisionId",
                table: "Resource");

            migrationBuilder.DropForeignKey(
                name: "FK_Shelter_AdministrativeDivision_AdministrativeDivisionId",
                table: "Shelter");

            migrationBuilder.DropIndex(
                name: "IX_Shelter_AdministrativeDivisionId",
                table: "Shelter");

            migrationBuilder.DropIndex(
                name: "IX_Resource_AdministrativeDivisionId",
                table: "Resource");

            migrationBuilder.DropIndex(
                name: "IX_Membership_UserId_OrganisationId_Role",
                table: "Membership");

            migrationBuilder.DropIndex(
                name: "IX_Crisis_AdministrativeDivisionId",
                table: "Crisis");

            migrationBuilder.DropIndex(
                name: "IX_AdministrativeDivision_ParentId",
                table: "AdministrativeDivision");

            migrationBuilder.AddColumn<string>(
                name: "CountryCode",
                table: "VolunteerProfile",
                type: "varchar(2)",
                unicode: false,
                maxLength: 2,
                nullable: false,
                defaultValue: "LK");

            migrationBuilder.AddColumn<string>(
                name: "CountryCode",
                table: "Membership",
                type: "varchar(2)",
                unicode: false,
                maxLength: 2,
                nullable: false,
                defaultValue: "LK");

            migrationBuilder.AddColumn<Guid>(
                name: "CrisisId",
                table: "Membership",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_Crisis_Id_CountryCode",
                table: "Crisis",
                columns: new[] { "Id", "CountryCode" });

            migrationBuilder.AddUniqueConstraint(
                name: "AK_AdministrativeDivision_Id_CountryCode",
                table: "AdministrativeDivision",
                columns: new[] { "Id", "CountryCode" });

            migrationBuilder.CreateIndex(
                name: "IX_VolunteerProfile_CountryCode",
                table: "VolunteerProfile",
                column: "CountryCode");

            migrationBuilder.CreateIndex(
                name: "IX_Shelter_AdministrativeDivisionId_CountryCode",
                table: "Shelter",
                columns: new[] { "AdministrativeDivisionId", "CountryCode" });

            migrationBuilder.CreateIndex(
                name: "IX_Resource_AdministrativeDivisionId_CountryCode",
                table: "Resource",
                columns: new[] { "AdministrativeDivisionId", "CountryCode" });

            migrationBuilder.CreateIndex(
                name: "IX_Membership_CountryCode",
                table: "Membership",
                column: "CountryCode");

            migrationBuilder.CreateIndex(
                name: "IX_Membership_CrisisId_CountryCode",
                table: "Membership",
                columns: new[] { "CrisisId", "CountryCode" });

            migrationBuilder.CreateIndex(
                name: "IX_Membership_UserId_OrganisationId_Role_CountryCode_CrisisId",
                table: "Membership",
                columns: new[] { "UserId", "OrganisationId", "Role", "CountryCode", "CrisisId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Crisis_AdministrativeDivisionId_CountryCode",
                table: "Crisis",
                columns: new[] { "AdministrativeDivisionId", "CountryCode" });

            migrationBuilder.CreateIndex(
                name: "IX_AdministrativeDivision_ParentId_CountryCode",
                table: "AdministrativeDivision",
                columns: new[] { "ParentId", "CountryCode" });

            migrationBuilder.AddForeignKey(
                name: "FK_AdministrativeDivision_AdministrativeDivision_ParentId_CountryCode",
                table: "AdministrativeDivision",
                columns: new[] { "ParentId", "CountryCode" },
                principalTable: "AdministrativeDivision",
                principalColumns: new[] { "Id", "CountryCode" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Crisis_AdministrativeDivision_AdministrativeDivisionId_CountryCode",
                table: "Crisis",
                columns: new[] { "AdministrativeDivisionId", "CountryCode" },
                principalTable: "AdministrativeDivision",
                principalColumns: new[] { "Id", "CountryCode" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Membership_Country_CountryCode",
                table: "Membership",
                column: "CountryCode",
                principalTable: "Country",
                principalColumn: "Code",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Membership_Crisis_CrisisId_CountryCode",
                table: "Membership",
                columns: new[] { "CrisisId", "CountryCode" },
                principalTable: "Crisis",
                principalColumns: new[] { "Id", "CountryCode" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Resource_AdministrativeDivision_AdministrativeDivisionId_CountryCode",
                table: "Resource",
                columns: new[] { "AdministrativeDivisionId", "CountryCode" },
                principalTable: "AdministrativeDivision",
                principalColumns: new[] { "Id", "CountryCode" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Shelter_AdministrativeDivision_AdministrativeDivisionId_CountryCode",
                table: "Shelter",
                columns: new[] { "AdministrativeDivisionId", "CountryCode" },
                principalTable: "AdministrativeDivision",
                principalColumns: new[] { "Id", "CountryCode" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_VolunteerProfile_Country_CountryCode",
                table: "VolunteerProfile",
                column: "CountryCode",
                principalTable: "Country",
                principalColumn: "Code",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [Membership] WHERE [CountryCode] <> 'LK' OR [CrisisId] IS NOT NULL) OR EXISTS (SELECT 1 FROM [VolunteerProfile] WHERE [CountryCode] <> 'LK') THROW 51000, 'Scoped country access is in use; rollback would remove access boundaries.', 1;");
            migrationBuilder.DropForeignKey(
                name: "FK_AdministrativeDivision_AdministrativeDivision_ParentId_CountryCode",
                table: "AdministrativeDivision");

            migrationBuilder.DropForeignKey(
                name: "FK_Crisis_AdministrativeDivision_AdministrativeDivisionId_CountryCode",
                table: "Crisis");

            migrationBuilder.DropForeignKey(
                name: "FK_Membership_Country_CountryCode",
                table: "Membership");

            migrationBuilder.DropForeignKey(
                name: "FK_Membership_Crisis_CrisisId_CountryCode",
                table: "Membership");

            migrationBuilder.DropForeignKey(
                name: "FK_Resource_AdministrativeDivision_AdministrativeDivisionId_CountryCode",
                table: "Resource");

            migrationBuilder.DropForeignKey(
                name: "FK_Shelter_AdministrativeDivision_AdministrativeDivisionId_CountryCode",
                table: "Shelter");

            migrationBuilder.DropForeignKey(
                name: "FK_VolunteerProfile_Country_CountryCode",
                table: "VolunteerProfile");

            migrationBuilder.DropIndex(
                name: "IX_VolunteerProfile_CountryCode",
                table: "VolunteerProfile");

            migrationBuilder.DropIndex(
                name: "IX_Shelter_AdministrativeDivisionId_CountryCode",
                table: "Shelter");

            migrationBuilder.DropIndex(
                name: "IX_Resource_AdministrativeDivisionId_CountryCode",
                table: "Resource");

            migrationBuilder.DropIndex(
                name: "IX_Membership_CountryCode",
                table: "Membership");

            migrationBuilder.DropIndex(
                name: "IX_Membership_CrisisId_CountryCode",
                table: "Membership");

            migrationBuilder.DropIndex(
                name: "IX_Membership_UserId_OrganisationId_Role_CountryCode_CrisisId",
                table: "Membership");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_Crisis_Id_CountryCode",
                table: "Crisis");

            migrationBuilder.DropIndex(
                name: "IX_Crisis_AdministrativeDivisionId_CountryCode",
                table: "Crisis");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_AdministrativeDivision_Id_CountryCode",
                table: "AdministrativeDivision");

            migrationBuilder.DropIndex(
                name: "IX_AdministrativeDivision_ParentId_CountryCode",
                table: "AdministrativeDivision");

            migrationBuilder.DropColumn(
                name: "CountryCode",
                table: "VolunteerProfile");

            migrationBuilder.DropColumn(
                name: "CountryCode",
                table: "Membership");

            migrationBuilder.DropColumn(
                name: "CrisisId",
                table: "Membership");

            migrationBuilder.CreateIndex(
                name: "IX_Shelter_AdministrativeDivisionId",
                table: "Shelter",
                column: "AdministrativeDivisionId");

            migrationBuilder.CreateIndex(
                name: "IX_Resource_AdministrativeDivisionId",
                table: "Resource",
                column: "AdministrativeDivisionId");

            migrationBuilder.CreateIndex(
                name: "IX_Membership_UserId_OrganisationId_Role",
                table: "Membership",
                columns: new[] { "UserId", "OrganisationId", "Role" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Crisis_AdministrativeDivisionId",
                table: "Crisis",
                column: "AdministrativeDivisionId");

            migrationBuilder.CreateIndex(
                name: "IX_AdministrativeDivision_ParentId",
                table: "AdministrativeDivision",
                column: "ParentId");

            migrationBuilder.AddForeignKey(
                name: "FK_AdministrativeDivision_AdministrativeDivision_ParentId",
                table: "AdministrativeDivision",
                column: "ParentId",
                principalTable: "AdministrativeDivision",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Crisis_AdministrativeDivision_AdministrativeDivisionId",
                table: "Crisis",
                column: "AdministrativeDivisionId",
                principalTable: "AdministrativeDivision",
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
                name: "FK_Shelter_AdministrativeDivision_AdministrativeDivisionId",
                table: "Shelter",
                column: "AdministrativeDivisionId",
                principalTable: "AdministrativeDivision",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
