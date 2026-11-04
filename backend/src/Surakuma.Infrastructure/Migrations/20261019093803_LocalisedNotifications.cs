using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class LocalisedNotifications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SinhalaMessage",
                table: "OutboxMessage",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "TamilMessage",
                table: "OutboxMessage",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "SinhalaMessage",
                table: "Notification",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "TamilMessage",
                table: "Notification",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SinhalaMessage",
                table: "OutboxMessage");

            migrationBuilder.DropColumn(
                name: "TamilMessage",
                table: "OutboxMessage");

            migrationBuilder.DropColumn(
                name: "SinhalaMessage",
                table: "Notification");

            migrationBuilder.DropColumn(
                name: "TamilMessage",
                table: "Notification");
        }
    }
}
