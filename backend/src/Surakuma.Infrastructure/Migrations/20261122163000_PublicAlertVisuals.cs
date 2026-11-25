using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class PublicAlertVisuals : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "VisualImageUrl",
                table: "PublicAlert",
                type: "nvarchar(240)",
                maxLength: 240,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "VisualKind",
                table: "PublicAlert",
                type: "nvarchar(24)",
                maxLength: 24,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "VisualSummary",
                table: "PublicAlert",
                type: "nvarchar(360)",
                maxLength: 360,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PublicAlertVisual",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    AlertId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    AvailableAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Lease = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Attempts = table.Column<int>(type: "int", nullable: false),
                    Completed = table.Column<bool>(type: "bit", nullable: false),
                    Image = table.Column<byte[]>(type: "varbinary(max)", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PublicAlertVisual", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PublicAlertVisual_PublicAlert_AlertId",
                        column: x => x.AlertId,
                        principalTable: "PublicAlert",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PublicAlertVisual_AlertId",
                table: "PublicAlertVisual",
                column: "AlertId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PublicAlertVisual_Completed_AvailableAt",
                table: "PublicAlertVisual",
                columns: new[] { "Completed", "AvailableAt" });

            migrationBuilder.Sql("""
                INSERT INTO dbo.PublicAlertVisual (Id, AlertId, AvailableAt, Attempts, Completed, CreatedAt, UpdatedAt)
                SELECT NEWID(), Id, SYSDATETIMEOFFSET(), 0, 0, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET()
                FROM dbo.PublicAlert
                WHERE Published = 1 AND ExpiresAt > SYSDATETIMEOFFSET()
                  AND (WorkflowState IS NULL OR WorkflowState IN (N'LegacyPublished', N'Published', N'EmergencyPublished'));
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PublicAlertVisual");

            migrationBuilder.DropColumn(
                name: "VisualImageUrl",
                table: "PublicAlert");

            migrationBuilder.DropColumn(
                name: "VisualKind",
                table: "PublicAlert");

            migrationBuilder.DropColumn(
                name: "VisualSummary",
                table: "PublicAlert");
        }
    }
}
