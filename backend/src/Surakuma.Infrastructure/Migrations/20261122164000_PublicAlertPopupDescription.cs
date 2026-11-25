using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class PublicAlertPopupDescription : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "DescriptionOnly",
                table: "PublicAlertVisual",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "PopupDescription",
                table: "PublicAlert",
                type: "nvarchar(480)",
                maxLength: 480,
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE visual
                SET DescriptionOnly = 1, Completed = 0, Attempts = 0, Lease = NULL,
                    AvailableAt = SYSDATETIMEOFFSET()
                FROM dbo.PublicAlertVisual AS visual
                JOIN dbo.PublicAlert AS alert ON visual.AlertId = alert.Id
                WHERE visual.Completed = 1 AND alert.Published = 1
                  AND alert.ExpiresAt > SYSDATETIMEOFFSET()
                  AND (alert.WorkflowState IS NULL OR alert.WorkflowState IN (N'LegacyPublished', N'Published', N'EmergencyPublished'));
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE dbo.PublicAlertVisual SET Completed = 1, Lease = NULL WHERE DescriptionOnly = 1 AND Completed = 0;
                """);

            migrationBuilder.DropColumn(
                name: "DescriptionOnly",
                table: "PublicAlertVisual");

            migrationBuilder.DropColumn(
                name: "PopupDescription",
                table: "PublicAlert");
        }
    }
}
