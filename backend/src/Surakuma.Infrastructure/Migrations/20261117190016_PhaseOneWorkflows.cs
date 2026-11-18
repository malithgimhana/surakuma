using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class PhaseOneWorkflows : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "WorkTitle", table: "CaseShare", type: "nvarchar(160)", maxLength: 160, nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WorkInstructions", table: "CaseShare", type: "nvarchar(1000)", maxLength: 1000, nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CreatorUserId",
                table: "PublicAlert",
                type: "nvarchar(450)",
                maxLength: 450,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EmergencyPublisherUserId",
                table: "PublicAlert",
                type: "nvarchar(450)",
                maxLength: 450,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PublishedAt",
                table: "PublicAlert",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReviewerUserId",
                table: "PublicAlert",
                type: "nvarchar(450)",
                maxLength: 450,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WorkflowState",
                table: "PublicAlert",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.Sql("UPDATE [PublicAlert] SET [WorkflowState] = 'LegacyPublished' WHERE [Published] = 1;");

            migrationBuilder.AddColumn<string>(
                name: "ScopeCountryCode",
                table: "Notification",
                type: "varchar(2)",
                unicode: false,
                maxLength: 2,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ScopeOrganisationId",
                table: "Notification",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScopeRole",
                table: "Notification",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "DeliveryConfirmation",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    AllocationId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    LogisticsOrderId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Reference = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    ConfirmedQuantity = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    ReceivedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ReceivedBy = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Method = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    Note = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    ExceptionDetail = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DeliveryConfirmation", x => x.Id);
                    table.CheckConstraint("CK_DeliveryConfirmation_Shipment", "(([AllocationId] IS NOT NULL AND [LogisticsOrderId] IS NULL) OR ([AllocationId] IS NULL AND [LogisticsOrderId] IS NOT NULL)) AND [ConfirmedQuantity] >= 0");
                    table.ForeignKey(
                        name: "FK_DeliveryConfirmation_LogisticsOrder_LogisticsOrderId",
                        column: x => x.LogisticsOrderId,
                        principalTable: "LogisticsOrder",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DeliveryConfirmation_ResourceAllocation_AllocationId",
                        column: x => x.AllocationId,
                        principalTable: "ResourceAllocation",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PartnerContribution",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CountryCode = table.Column<string>(type: "varchar(2)", unicode: false, maxLength: 2, nullable: false),
                    Title = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Unit = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Quantity = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    FulfilledQuantity = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PartnerContribution", x => x.Id);
                    table.CheckConstraint("CK_PartnerContribution_Quantity", "[Quantity] > 0 AND [FulfilledQuantity] >= 0 AND [FulfilledQuantity] <= [Quantity]");
                    table.ForeignKey(
                        name: "FK_PartnerContribution_Country_CountryCode",
                        column: x => x.CountryCode,
                        principalTable: "Country",
                        principalColumn: "Code",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PartnerContribution_Organisation_OrganisationId",
                        column: x => x.OrganisationId,
                        principalTable: "Organisation",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "VolunteerTaskEvent",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TaskId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    Action = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    WorkDescription = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Outcome = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    PeopleAssisted = table.Column<int>(type: "int", nullable: true),
                    Issues = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Note = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VolunteerTaskEvent", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VolunteerTaskEvent_VolunteerTask_TaskId",
                        column: x => x.TaskId,
                        principalTable: "VolunteerTask",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryConfirmation_AllocationId",
                table: "DeliveryConfirmation",
                column: "AllocationId",
                unique: true,
                filter: "[AllocationId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryConfirmation_LogisticsOrderId",
                table: "DeliveryConfirmation",
                column: "LogisticsOrderId",
                unique: true,
                filter: "[LogisticsOrderId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_PartnerContribution_CountryCode_OrganisationId_Status",
                table: "PartnerContribution",
                columns: new[] { "CountryCode", "OrganisationId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_PartnerContribution_OrganisationId",
                table: "PartnerContribution",
                column: "OrganisationId");

            migrationBuilder.CreateIndex(
                name: "IX_VolunteerTaskEvent_TaskId_CreatedAt",
                table: "VolunteerTaskEvent",
                columns: new[] { "TaskId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "WorkTitle", table: "CaseShare");
            migrationBuilder.DropColumn(name: "WorkInstructions", table: "CaseShare");

            migrationBuilder.DropTable(
                name: "DeliveryConfirmation");

            migrationBuilder.DropTable(
                name: "PartnerContribution");

            migrationBuilder.DropTable(
                name: "VolunteerTaskEvent");

            migrationBuilder.DropColumn(
                name: "CreatorUserId",
                table: "PublicAlert");

            migrationBuilder.DropColumn(
                name: "EmergencyPublisherUserId",
                table: "PublicAlert");

            migrationBuilder.DropColumn(
                name: "PublishedAt",
                table: "PublicAlert");

            migrationBuilder.DropColumn(
                name: "ReviewerUserId",
                table: "PublicAlert");

            migrationBuilder.DropColumn(
                name: "WorkflowState",
                table: "PublicAlert");

            migrationBuilder.DropColumn(
                name: "ScopeCountryCode",
                table: "Notification");

            migrationBuilder.DropColumn(
                name: "ScopeOrganisationId",
                table: "Notification");

            migrationBuilder.DropColumn(
                name: "ScopeRole",
                table: "Notification");
        }
    }
}
