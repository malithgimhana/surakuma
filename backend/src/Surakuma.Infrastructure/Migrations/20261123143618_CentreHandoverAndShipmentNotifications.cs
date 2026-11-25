using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class CentreHandoverAndShipmentNotifications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "HandoverQuantitiesJson",
                table: "VolunteerTaskEvent",
                type: "nvarchar(max)",
                maxLength: -1,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CaseDispatchId",
                table: "VolunteerTask",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CaseDispatchId",
                table: "ResourceAllocation",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "CentreReceivedQuantity",
                table: "ResourceAllocation",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "CitizenReceivedQuantity",
                table: "ResourceAllocation",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "AllocationId",
                table: "Notification",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "HandoverCentreId",
                table: "AssistanceRequest",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "RequiresCentreHandover",
                table: "AssistanceRequest",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "CaseDispatch",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RequestId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CentreId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Reference = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    DispatchedBy = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    ReceivedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ReceivedBy = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
                    ReceiptNote = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CaseDispatch", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CaseDispatch_AssistanceRequest_RequestId",
                        column: x => x.RequestId,
                        principalTable: "AssistanceRequest",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CaseDispatch_Depot_CentreId",
                        column: x => x.CentreId,
                        principalTable: "Depot",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_VolunteerTask_CaseDispatchId",
                table: "VolunteerTask",
                column: "CaseDispatchId");

            migrationBuilder.CreateIndex(
                name: "IX_ResourceAllocation_CaseDispatchId",
                table: "ResourceAllocation",
                column: "CaseDispatchId");

            migrationBuilder.CreateIndex(
                name: "IX_AssistanceRequest_HandoverCentreId",
                table: "AssistanceRequest",
                column: "HandoverCentreId");

            migrationBuilder.CreateIndex(
                name: "IX_CaseDispatch_CentreId",
                table: "CaseDispatch",
                column: "CentreId");

            migrationBuilder.CreateIndex(
                name: "IX_CaseDispatch_Reference",
                table: "CaseDispatch",
                column: "Reference",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CaseDispatch_RequestId",
                table: "CaseDispatch",
                column: "RequestId");

            migrationBuilder.AddForeignKey(
                name: "FK_AssistanceRequest_Depot_HandoverCentreId",
                table: "AssistanceRequest",
                column: "HandoverCentreId",
                principalTable: "Depot",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ResourceAllocation_CaseDispatch_CaseDispatchId",
                table: "ResourceAllocation",
                column: "CaseDispatchId",
                principalTable: "CaseDispatch",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_VolunteerTask_CaseDispatch_CaseDispatchId",
                table: "VolunteerTask",
                column: "CaseDispatchId",
                principalTable: "CaseDispatch",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_AssistanceRequest_Depot_HandoverCentreId",
                table: "AssistanceRequest");

            migrationBuilder.DropForeignKey(
                name: "FK_ResourceAllocation_CaseDispatch_CaseDispatchId",
                table: "ResourceAllocation");

            migrationBuilder.DropForeignKey(
                name: "FK_VolunteerTask_CaseDispatch_CaseDispatchId",
                table: "VolunteerTask");

            migrationBuilder.DropTable(
                name: "CaseDispatch");

            migrationBuilder.DropIndex(
                name: "IX_VolunteerTask_CaseDispatchId",
                table: "VolunteerTask");

            migrationBuilder.DropIndex(
                name: "IX_ResourceAllocation_CaseDispatchId",
                table: "ResourceAllocation");

            migrationBuilder.DropIndex(
                name: "IX_AssistanceRequest_HandoverCentreId",
                table: "AssistanceRequest");

            migrationBuilder.DropColumn(
                name: "HandoverQuantitiesJson",
                table: "VolunteerTaskEvent");

            migrationBuilder.DropColumn(
                name: "CaseDispatchId",
                table: "VolunteerTask");

            migrationBuilder.DropColumn(
                name: "CaseDispatchId",
                table: "ResourceAllocation");

            migrationBuilder.DropColumn(
                name: "CentreReceivedQuantity",
                table: "ResourceAllocation");

            migrationBuilder.DropColumn(
                name: "CitizenReceivedQuantity",
                table: "ResourceAllocation");

            migrationBuilder.DropColumn(
                name: "AllocationId",
                table: "Notification");

            migrationBuilder.DropColumn(
                name: "HandoverCentreId",
                table: "AssistanceRequest");

            migrationBuilder.DropColumn(
                name: "RequiresCentreHandover",
                table: "AssistanceRequest");
        }
    }
}
