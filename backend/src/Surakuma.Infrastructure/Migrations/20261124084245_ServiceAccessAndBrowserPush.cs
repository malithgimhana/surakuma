using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ServiceAccessAndBrowserPush : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Notification_UserId",
                table: "Notification");

            migrationBuilder.CreateTable(
                name: "AssistanceCentre",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CountryCode = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DepotId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Name = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Address = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Latitude = table.Column<double>(type: "float", nullable: false),
                    Longitude = table.Column<double>(type: "float", nullable: false),
                    Services = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Facilities = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    OpeningHours = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Accessible = table.Column<bool>(type: "bit", nullable: false),
                    Capacity = table.Column<int>(type: "int", nullable: true),
                    Published = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssistanceCentre", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "BrowserPushSubscription",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    Endpoint = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    EndpointHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    PublicKey = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    AuthSecret = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    EnabledAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BrowserPushSubscription", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "VolunteerAvailabilityWindow",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    StartsAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    EndsAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VolunteerAvailabilityWindow", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "BrowserPushDelivery",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SubscriptionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    NotificationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    State = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Attempts = table.Column<int>(type: "int", nullable: false),
                    NextAttemptAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BrowserPushDelivery", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BrowserPushDelivery_BrowserPushSubscription_SubscriptionId",
                        column: x => x.SubscriptionId,
                        principalTable: "BrowserPushSubscription",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_BrowserPushDelivery_Notification_NotificationId",
                        column: x => x.NotificationId,
                        principalTable: "Notification",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Notification_UserId_CreatedAt",
                table: "Notification",
                columns: new[] { "UserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_AssistanceCentre_CountryCode_Published",
                table: "AssistanceCentre",
                columns: new[] { "CountryCode", "Published" });

            migrationBuilder.CreateIndex(
                name: "IX_BrowserPushDelivery_NotificationId",
                table: "BrowserPushDelivery",
                column: "NotificationId");

            migrationBuilder.CreateIndex(
                name: "IX_BrowserPushDelivery_SubscriptionId_NotificationId",
                table: "BrowserPushDelivery",
                columns: new[] { "SubscriptionId", "NotificationId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BrowserPushSubscription_EndpointHash",
                table: "BrowserPushSubscription",
                column: "EndpointHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BrowserPushSubscription_UserId",
                table: "BrowserPushSubscription",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_VolunteerAvailabilityWindow_UserId_StartsAt",
                table: "VolunteerAvailabilityWindow",
                columns: new[] { "UserId", "StartsAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AssistanceCentre");

            migrationBuilder.DropTable(
                name: "BrowserPushDelivery");

            migrationBuilder.DropTable(
                name: "VolunteerAvailabilityWindow");

            migrationBuilder.DropTable(
                name: "BrowserPushSubscription");

            migrationBuilder.DropIndex(
                name: "IX_Notification_UserId_CreatedAt",
                table: "Notification");

            migrationBuilder.CreateIndex(
                name: "IX_Notification_UserId",
                table: "Notification",
                column: "UserId");
        }
    }
}
