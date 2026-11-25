using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class RequestIntelligence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "ServiceLatitude",
                table: "VolunteerProfile",
                type: "float",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ServiceLocationConsent",
                table: "VolunteerProfile",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<double>(
                name: "ServiceLongitude",
                table: "VolunteerProfile",
                type: "float",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ServiceRegionId",
                table: "VolunteerProfile",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SignalsJson",
                table: "Recommendation",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UrgencyFactorsJson",
                table: "Recommendation",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "UrgencyScore",
                table: "Recommendation",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Model",
                table: "PotentialDuplicate",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CommunicationSource",
                table: "OutboxMessage",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CopyLanguage",
                table: "OutboxMessage",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReviewedCopy",
                table: "OutboxMessage",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CommunicationSource",
                table: "Notification",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HindiMessage",
                table: "Notification",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NepaliMessage",
                table: "Notification",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "AiInvocation",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Task = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Provider = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Model = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    State = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    ProcessingMs = table.Column<int>(type: "int", nullable: false),
                    InputTokens = table.Column<int>(type: "int", nullable: true),
                    OutputTokens = table.Column<int>(type: "int", nullable: true),
                    EstimatedUsd = table.Column<decimal>(type: "decimal(18,8)", precision: 18, scale: 8, nullable: true),
                    FallbackReason = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AiInvocation", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "CaseMessageDraft",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RequestId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    StatusSnapshot = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    Audience = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Language = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Copy = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Source = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    CreatedByUserId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    ReviewerUserId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: true),
                    PublishedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CaseMessageDraft", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CaseMessageDraft_AssistanceRequest_RequestId",
                        column: x => x.RequestId,
                        principalTable: "AssistanceRequest",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RequestAnalysisJob",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RequestId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    State = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Attempts = table.Column<int>(type: "int", nullable: false),
                    AvailableAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Lease = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CompletedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    FailureReason = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RequestAnalysisJob", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RequestAnalysisJob_AssistanceRequest_RequestId",
                        column: x => x.RequestId,
                        principalTable: "AssistanceRequest",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RequestEmbedding",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RequestId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Model = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Vector = table.Column<byte[]>(type: "varbinary(1024)", maxLength: 1024, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RequestEmbedding", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RequestEmbedding_AssistanceRequest_RequestId",
                        column: x => x.RequestId,
                        principalTable: "AssistanceRequest",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_VolunteerProfile_ServiceRegionId",
                table: "VolunteerProfile",
                column: "ServiceRegionId");

            migrationBuilder.CreateIndex(
                name: "IX_CaseMessageDraft_RequestId_CreatedAt",
                table: "CaseMessageDraft",
                columns: new[] { "RequestId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_RequestAnalysisJob_RequestId",
                table: "RequestAnalysisJob",
                column: "RequestId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RequestAnalysisJob_State_AvailableAt",
                table: "RequestAnalysisJob",
                columns: new[] { "State", "AvailableAt" });

            migrationBuilder.CreateIndex(
                name: "IX_RequestEmbedding_RequestId",
                table: "RequestEmbedding",
                column: "RequestId",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_VolunteerProfile_AdministrativeDivision_ServiceRegionId",
                table: "VolunteerProfile",
                column: "ServiceRegionId",
                principalTable: "AdministrativeDivision",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_VolunteerProfile_AdministrativeDivision_ServiceRegionId",
                table: "VolunteerProfile");

            migrationBuilder.DropTable(
                name: "AiInvocation");

            migrationBuilder.DropTable(
                name: "CaseMessageDraft");

            migrationBuilder.DropTable(
                name: "RequestAnalysisJob");

            migrationBuilder.DropTable(
                name: "RequestEmbedding");

            migrationBuilder.DropIndex(
                name: "IX_VolunteerProfile_ServiceRegionId",
                table: "VolunteerProfile");

            migrationBuilder.DropColumn(
                name: "ServiceLatitude",
                table: "VolunteerProfile");

            migrationBuilder.DropColumn(
                name: "ServiceLocationConsent",
                table: "VolunteerProfile");

            migrationBuilder.DropColumn(
                name: "ServiceLongitude",
                table: "VolunteerProfile");

            migrationBuilder.DropColumn(
                name: "ServiceRegionId",
                table: "VolunteerProfile");

            migrationBuilder.DropColumn(
                name: "SignalsJson",
                table: "Recommendation");

            migrationBuilder.DropColumn(
                name: "UrgencyFactorsJson",
                table: "Recommendation");

            migrationBuilder.DropColumn(
                name: "UrgencyScore",
                table: "Recommendation");

            migrationBuilder.DropColumn(
                name: "Model",
                table: "PotentialDuplicate");

            migrationBuilder.DropColumn(
                name: "CommunicationSource",
                table: "OutboxMessage");

            migrationBuilder.DropColumn(
                name: "CopyLanguage",
                table: "OutboxMessage");

            migrationBuilder.DropColumn(
                name: "ReviewedCopy",
                table: "OutboxMessage");

            migrationBuilder.DropColumn(
                name: "CommunicationSource",
                table: "Notification");

            migrationBuilder.DropColumn(
                name: "HindiMessage",
                table: "Notification");

            migrationBuilder.DropColumn(
                name: "NepaliMessage",
                table: "Notification");
        }
    }
}
