using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class FulfillmentOperations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "NeedId",
                table: "ResourceAllocation",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PackedAt",
                table: "ResourceAllocation",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PackedBy",
                table: "ResourceAllocation",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ScheduledArrivalAt",
                table: "ResourceAllocation",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DepotId",
                table: "Membership",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PackedAt",
                table: "LogisticsOrder",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PackedBy",
                table: "LogisticsOrder",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "RequiresPacking",
                table: "LogisticsOrder",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ScheduledArrivalAt",
                table: "LogisticsOrder",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "AuthorizedAt",
                table: "AssistanceRequest",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AuthorizedBy",
                table: "AssistanceRequest",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "RequiresCoordinatorAuthorization",
                table: "AssistanceRequest",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "CaseNeed",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RequestId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Category = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Unit = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    RequiredQuantity = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    ApprovedQuantity = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    DeliveredQuantity = table.Column<decimal>(type: "decimal(18,5)", precision: 18, scale: 5, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CaseNeed", x => x.Id);
                    table.CheckConstraint("CK_CaseNeed_Quantities", "[RequiredQuantity] > 0 AND [ApprovedQuantity] > 0 AND [DeliveredQuantity] >= 0 AND [DeliveredQuantity] <= [ApprovedQuantity]");
                    table.ForeignKey(
                        name: "FK_CaseNeed_AssistanceRequest_RequestId",
                        column: x => x.RequestId,
                        principalTable: "AssistanceRequest",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "LogisticsPreferences",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    DispatchUpdates = table.Column<bool>(type: "bit", nullable: false),
                    StockAlerts = table.Column<bool>(type: "bit", nullable: false),
                    SupplyUpdates = table.Column<bool>(type: "bit", nullable: false),
                    AssignmentUpdates = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LogisticsPreferences", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LogisticsPreferences_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ResourceAllocation_NeedId",
                table: "ResourceAllocation",
                column: "NeedId");

            migrationBuilder.CreateIndex(
                name: "IX_Membership_DepotId",
                table: "Membership",
                column: "DepotId");

            migrationBuilder.CreateIndex(
                name: "IX_CaseNeed_RequestId",
                table: "CaseNeed",
                column: "RequestId");

            migrationBuilder.CreateIndex(
                name: "IX_LogisticsPreferences_UserId",
                table: "LogisticsPreferences",
                column: "UserId",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Membership_Depot_DepotId",
                table: "Membership",
                column: "DepotId",
                principalTable: "Depot",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ResourceAllocation_CaseNeed_NeedId",
                table: "ResourceAllocation",
                column: "NeedId",
                principalTable: "CaseNeed",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Membership_Depot_DepotId",
                table: "Membership");

            migrationBuilder.DropForeignKey(
                name: "FK_ResourceAllocation_CaseNeed_NeedId",
                table: "ResourceAllocation");

            migrationBuilder.DropTable(
                name: "CaseNeed");

            migrationBuilder.DropTable(
                name: "LogisticsPreferences");

            migrationBuilder.DropIndex(
                name: "IX_ResourceAllocation_NeedId",
                table: "ResourceAllocation");

            migrationBuilder.DropIndex(
                name: "IX_Membership_DepotId",
                table: "Membership");

            migrationBuilder.DropColumn(
                name: "NeedId",
                table: "ResourceAllocation");

            migrationBuilder.DropColumn(
                name: "PackedAt",
                table: "ResourceAllocation");

            migrationBuilder.DropColumn(
                name: "PackedBy",
                table: "ResourceAllocation");

            migrationBuilder.DropColumn(
                name: "ScheduledArrivalAt",
                table: "ResourceAllocation");

            migrationBuilder.DropColumn(
                name: "DepotId",
                table: "Membership");

            migrationBuilder.DropColumn(
                name: "PackedAt",
                table: "LogisticsOrder");

            migrationBuilder.DropColumn(
                name: "PackedBy",
                table: "LogisticsOrder");

            migrationBuilder.DropColumn(
                name: "RequiresPacking",
                table: "LogisticsOrder");

            migrationBuilder.DropColumn(
                name: "ScheduledArrivalAt",
                table: "LogisticsOrder");

            migrationBuilder.DropColumn(
                name: "AuthorizedAt",
                table: "AssistanceRequest");

            migrationBuilder.DropColumn(
                name: "AuthorizedBy",
                table: "AssistanceRequest");

            migrationBuilder.DropColumn(
                name: "RequiresCoordinatorAuthorization",
                table: "AssistanceRequest");
        }
    }
}
