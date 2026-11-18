using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class FundingAndDecisionSupport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF NOT EXISTS (SELECT 1 FROM AspNetRoles WHERE NormalizedName = N'FUNDINGOFFICER')
                    INSERT INTO AspNetRoles (Id, Name, NormalizedName)
                    VALUES (N'96287a21-1468-4422-aaa0-ab6b0fa8a84e', N'FundingOfficer', N'FUNDINGOFFICER');
                """);
            migrationBuilder.DropIndex(
                name: "IX_VolunteerTask_VolunteerId",
                table: "VolunteerTask");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "StartsAt",
                table: "VolunteerTask",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Category",
                table: "PartnerContribution",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SupportRequestId",
                table: "PartnerContribution",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CaseConsolidation",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    OriginalRequestId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PrimaryRequestId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CaseConsolidation", x => x.Id);
                    table.CheckConstraint("CK_CaseConsolidation_Distinct", "[OriginalRequestId] <> [PrimaryRequestId]");
                    table.ForeignKey(
                        name: "FK_CaseConsolidation_AssistanceRequest_OriginalRequestId",
                        column: x => x.OriginalRequestId,
                        principalTable: "AssistanceRequest",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CaseConsolidation_AssistanceRequest_PrimaryRequestId",
                        column: x => x.PrimaryRequestId,
                        principalTable: "AssistanceRequest",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CrisisBriefing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CrisisId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PeriodFrom = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    PeriodTo = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    FactsJson = table.Column<string>(type: "nvarchar(max)", maxLength: 4000, nullable: false),
                    Draft = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Source = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    CreatedByUserId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    ReviewerUserId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: true),
                    ReviewedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ReviewNote = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CrisisBriefing", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CrisisBriefing_Crisis_CrisisId",
                        column: x => x.CrisisId,
                        principalTable: "Crisis",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DemandForecast",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CrisisId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RegionId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Category = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    ObservedFrom = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ForecastFrom = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ForecastTo = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Model = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Estimate = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: true),
                    InputsJson = table.Column<string>(type: "nvarchar(max)", maxLength: 4000, nullable: false),
                    CreatedByUserId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DemandForecast", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DemandForecast_AdministrativeDivision_RegionId",
                        column: x => x.RegionId,
                        principalTable: "AdministrativeDivision",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DemandForecast_Crisis_CrisisId",
                        column: x => x.CrisisId,
                        principalTable: "Crisis",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DonorProfile",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    DisplayName = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    OrganisationName = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DonorProfile", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DonorProfile_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "FundingCampaign",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CountryCode = table.Column<string>(type: "varchar(2)", unicode: false, maxLength: 2, nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CrisisId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Name = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    Purpose = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    Currency = table.Column<string>(type: "varchar(3)", unicode: false, maxLength: 3, nullable: false),
                    Budget = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Open = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FundingCampaign", x => x.Id);
                    table.CheckConstraint("CK_FundingCampaign_Budget", "[Budget] > 0");
                    table.ForeignKey(
                        name: "FK_FundingCampaign_Country_CountryCode",
                        column: x => x.CountryCode,
                        principalTable: "Country",
                        principalColumn: "Code",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_FundingCampaign_Crisis_CrisisId_CountryCode",
                        columns: x => new { x.CrisisId, x.CountryCode },
                        principalTable: "Crisis",
                        principalColumns: new[] { "Id", "CountryCode" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_FundingCampaign_Organisation_OrganisationId",
                        column: x => x.OrganisationId,
                        principalTable: "Organisation",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PartnerStockReceipt",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ContributionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    StockMovementId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Reference = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Quantity = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PartnerStockReceipt", x => x.Id);
                    table.CheckConstraint("CK_PartnerStockReceipt_Quantity", "[Quantity] > 0");
                    table.ForeignKey(
                        name: "FK_PartnerStockReceipt_PartnerContribution_ContributionId",
                        column: x => x.ContributionId,
                        principalTable: "PartnerContribution",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PartnerStockReceipt_StockMovement_StockMovementId",
                        column: x => x.StockMovementId,
                        principalTable: "StockMovement",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SupplyRequest",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CountryCode = table.Column<string>(type: "varchar(2)", unicode: false, maxLength: 2, nullable: false),
                    RequestingOrganisationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TargetOrganisationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ShelterId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CaseId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CrisisId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Category = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Unit = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Quantity = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    ReceivedQuantity = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Cancelled = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SupplyRequest", x => x.Id);
                    table.CheckConstraint("CK_SupplyRequest_Balance", "[Quantity] > 0 AND [ReceivedQuantity] BETWEEN 0 AND [Quantity] AND [RequestingOrganisationId] <> [TargetOrganisationId] AND ([ShelterId] IS NULL OR [CaseId] IS NULL)");
                    table.ForeignKey(
                        name: "FK_SupplyRequest_AssistanceRequest_CaseId",
                        column: x => x.CaseId,
                        principalTable: "AssistanceRequest",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SupplyRequest_Country_CountryCode",
                        column: x => x.CountryCode,
                        principalTable: "Country",
                        principalColumn: "Code",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SupplyRequest_Crisis_CrisisId",
                        column: x => x.CrisisId,
                        principalTable: "Crisis",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SupplyRequest_Organisation_RequestingOrganisationId",
                        column: x => x.RequestingOrganisationId,
                        principalTable: "Organisation",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SupplyRequest_Organisation_TargetOrganisationId",
                        column: x => x.TargetOrganisationId,
                        principalTable: "Organisation",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SupplyRequest_Shelter_ShelterId",
                        column: x => x.ShelterId,
                        principalTable: "Shelter",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Donation",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CampaignId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DonorId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Category = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Unit = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    State = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    ReceiptReference = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    StockMovementId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    ResourceId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Donation", x => x.Id);
                    table.CheckConstraint("CK_Donation_Amount", "[Amount] > 0");
                    table.ForeignKey(
                        name: "FK_Donation_DonorProfile_DonorId",
                        column: x => x.DonorId,
                        principalTable: "DonorProfile",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Donation_FundingCampaign_CampaignId",
                        column: x => x.CampaignId,
                        principalTable: "FundingCampaign",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Donation_Resource_ResourceId",
                        column: x => x.ResourceId,
                        principalTable: "Resource",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Donation_StockMovement_StockMovementId",
                        column: x => x.StockMovementId,
                        principalTable: "StockMovement",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DonationAllocation",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DonationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RequestId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DonationAllocation", x => x.Id);
                    table.CheckConstraint("CK_DonationAllocation_Amount", "[Amount] > 0");
                    table.ForeignKey(
                        name: "FK_DonationAllocation_AssistanceRequest_RequestId",
                        column: x => x.RequestId,
                        principalTable: "AssistanceRequest",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DonationAllocation_Donation_DonationId",
                        column: x => x.DonationId,
                        principalTable: "Donation",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DonationEvent",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DonationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    State = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Activity = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DonationEvent", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DonationEvent_Donation_DonationId",
                        column: x => x.DonationId,
                        principalTable: "Donation",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "InvestigationFlag",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RequestId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    DonationId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Category = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Severity = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Evidence = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Outcome = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    ReviewerUserId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: true),
                    ReviewedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Resolution = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvestigationFlag", x => x.Id);
                    table.CheckConstraint("CK_InvestigationFlag_Subject", "([RequestId] IS NOT NULL AND [DonationId] IS NULL) OR ([RequestId] IS NULL AND [DonationId] IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_InvestigationFlag_AssistanceRequest_RequestId",
                        column: x => x.RequestId,
                        principalTable: "AssistanceRequest",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InvestigationFlag_Donation_DonationId",
                        column: x => x.DonationId,
                        principalTable: "Donation",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DonationExpenditure",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    AllocationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Reference = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    DeliveryConfirmationId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DonationExpenditure", x => x.Id);
                    table.CheckConstraint("CK_DonationExpenditure_Amount", "[Amount] > 0");
                    table.ForeignKey(
                        name: "FK_DonationExpenditure_DeliveryConfirmation_DeliveryConfirmationId",
                        column: x => x.DeliveryConfirmationId,
                        principalTable: "DeliveryConfirmation",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DonationExpenditure_DonationAllocation_AllocationId",
                        column: x => x.AllocationId,
                        principalTable: "DonationAllocation",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_VolunteerTask_VolunteerId_Status_DueAt",
                table: "VolunteerTask",
                columns: new[] { "VolunteerId", "Status", "DueAt" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_VolunteerTask_Window",
                table: "VolunteerTask",
                sql: "[StartsAt] IS NULL OR [StartsAt] < [DueAt]");

            migrationBuilder.CreateIndex(
                name: "IX_PartnerContribution_SupportRequestId",
                table: "PartnerContribution",
                column: "SupportRequestId");

            migrationBuilder.CreateIndex(
                name: "IX_CaseConsolidation_OriginalRequestId",
                table: "CaseConsolidation",
                column: "OriginalRequestId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CaseConsolidation_PrimaryRequestId",
                table: "CaseConsolidation",
                column: "PrimaryRequestId");

            migrationBuilder.CreateIndex(
                name: "IX_CrisisBriefing_CrisisId_CreatedAt",
                table: "CrisisBriefing",
                columns: new[] { "CrisisId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_DemandForecast_CrisisId_Category_CreatedAt",
                table: "DemandForecast",
                columns: new[] { "CrisisId", "Category", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_DemandForecast_RegionId",
                table: "DemandForecast",
                column: "RegionId");

            migrationBuilder.CreateIndex(
                name: "IX_Donation_CampaignId_ReceiptReference",
                table: "Donation",
                columns: new[] { "CampaignId", "ReceiptReference" });

            migrationBuilder.CreateIndex(
                name: "IX_Donation_DonorId",
                table: "Donation",
                column: "DonorId");

            migrationBuilder.CreateIndex(
                name: "IX_Donation_ResourceId",
                table: "Donation",
                column: "ResourceId");

            migrationBuilder.CreateIndex(
                name: "IX_Donation_StockMovementId",
                table: "Donation",
                column: "StockMovementId",
                unique: true,
                filter: "[StockMovementId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_DonationAllocation_DonationId",
                table: "DonationAllocation",
                column: "DonationId");

            migrationBuilder.CreateIndex(
                name: "IX_DonationAllocation_RequestId",
                table: "DonationAllocation",
                column: "RequestId");

            migrationBuilder.CreateIndex(
                name: "IX_DonationEvent_DonationId_CreatedAt",
                table: "DonationEvent",
                columns: new[] { "DonationId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_DonationExpenditure_AllocationId",
                table: "DonationExpenditure",
                column: "AllocationId");

            migrationBuilder.CreateIndex(
                name: "IX_DonationExpenditure_DeliveryConfirmationId",
                table: "DonationExpenditure",
                column: "DeliveryConfirmationId",
                unique: true,
                filter: "[DeliveryConfirmationId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_DonorProfile_UserId",
                table: "DonorProfile",
                column: "UserId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FundingCampaign_CountryCode_OrganisationId",
                table: "FundingCampaign",
                columns: new[] { "CountryCode", "OrganisationId" });

            migrationBuilder.CreateIndex(
                name: "IX_FundingCampaign_CrisisId_CountryCode",
                table: "FundingCampaign",
                columns: new[] { "CrisisId", "CountryCode" });

            migrationBuilder.CreateIndex(
                name: "IX_FundingCampaign_OrganisationId",
                table: "FundingCampaign",
                column: "OrganisationId");

            migrationBuilder.CreateIndex(
                name: "IX_InvestigationFlag_DonationId_Category",
                table: "InvestigationFlag",
                columns: new[] { "DonationId", "Category" },
                unique: true,
                filter: "[DonationId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_InvestigationFlag_RequestId_Category",
                table: "InvestigationFlag",
                columns: new[] { "RequestId", "Category" },
                unique: true,
                filter: "[RequestId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_PartnerStockReceipt_ContributionId_Reference",
                table: "PartnerStockReceipt",
                columns: new[] { "ContributionId", "Reference" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PartnerStockReceipt_StockMovementId",
                table: "PartnerStockReceipt",
                column: "StockMovementId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SupplyRequest_CaseId",
                table: "SupplyRequest",
                column: "CaseId");

            migrationBuilder.CreateIndex(
                name: "IX_SupplyRequest_CountryCode_RequestingOrganisationId_CreatedAt",
                table: "SupplyRequest",
                columns: new[] { "CountryCode", "RequestingOrganisationId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_SupplyRequest_CountryCode_TargetOrganisationId_CreatedAt",
                table: "SupplyRequest",
                columns: new[] { "CountryCode", "TargetOrganisationId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_SupplyRequest_CrisisId",
                table: "SupplyRequest",
                column: "CrisisId");

            migrationBuilder.CreateIndex(
                name: "IX_SupplyRequest_RequestingOrganisationId",
                table: "SupplyRequest",
                column: "RequestingOrganisationId");

            migrationBuilder.CreateIndex(
                name: "IX_SupplyRequest_ShelterId",
                table: "SupplyRequest",
                column: "ShelterId");

            migrationBuilder.CreateIndex(
                name: "IX_SupplyRequest_TargetOrganisationId",
                table: "SupplyRequest",
                column: "TargetOrganisationId");

            migrationBuilder.AddForeignKey(
                name: "FK_PartnerContribution_SupplyRequest_SupportRequestId",
                table: "PartnerContribution",
                column: "SupportRequestId",
                principalTable: "SupplyRequest",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PartnerContribution_SupplyRequest_SupportRequestId",
                table: "PartnerContribution");

            migrationBuilder.DropTable(
                name: "CaseConsolidation");

            migrationBuilder.DropTable(
                name: "CrisisBriefing");

            migrationBuilder.DropTable(
                name: "DemandForecast");

            migrationBuilder.DropTable(
                name: "DonationEvent");

            migrationBuilder.DropTable(
                name: "DonationExpenditure");

            migrationBuilder.DropTable(
                name: "InvestigationFlag");

            migrationBuilder.DropTable(
                name: "PartnerStockReceipt");

            migrationBuilder.DropTable(
                name: "SupplyRequest");

            migrationBuilder.DropTable(
                name: "DonationAllocation");

            migrationBuilder.DropTable(
                name: "Donation");

            migrationBuilder.DropTable(
                name: "DonorProfile");

            migrationBuilder.DropTable(
                name: "FundingCampaign");

            migrationBuilder.DropIndex(
                name: "IX_VolunteerTask_VolunteerId_Status_DueAt",
                table: "VolunteerTask");

            migrationBuilder.DropCheckConstraint(
                name: "CK_VolunteerTask_Window",
                table: "VolunteerTask");

            migrationBuilder.DropIndex(
                name: "IX_PartnerContribution_SupportRequestId",
                table: "PartnerContribution");

            migrationBuilder.DropColumn(
                name: "StartsAt",
                table: "VolunteerTask");

            migrationBuilder.DropColumn(
                name: "Category",
                table: "PartnerContribution");

            migrationBuilder.DropColumn(
                name: "SupportRequestId",
                table: "PartnerContribution");

            migrationBuilder.CreateIndex(
                name: "IX_VolunteerTask_VolunteerId",
                table: "VolunteerTask",
                column: "VolunteerId");
        }
    }
}
