using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ScopedVolunteerRegistration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "TaskDispatchId",
                table: "VolunteerProfile",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "TaskRequestId",
                table: "VolunteerProfile",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_VolunteerProfile_TaskDispatchId",
                table: "VolunteerProfile",
                column: "TaskDispatchId");

            migrationBuilder.CreateIndex(
                name: "IX_VolunteerProfile_TaskRequestId",
                table: "VolunteerProfile",
                column: "TaskRequestId");

            migrationBuilder.AddForeignKey(
                name: "FK_VolunteerProfile_AssistanceRequest_TaskRequestId",
                table: "VolunteerProfile",
                column: "TaskRequestId",
                principalTable: "AssistanceRequest",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_VolunteerProfile_CaseDispatch_TaskDispatchId",
                table: "VolunteerProfile",
                column: "TaskDispatchId",
                principalTable: "CaseDispatch",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_VolunteerProfile_AssistanceRequest_TaskRequestId",
                table: "VolunteerProfile");

            migrationBuilder.DropForeignKey(
                name: "FK_VolunteerProfile_CaseDispatch_TaskDispatchId",
                table: "VolunteerProfile");

            migrationBuilder.DropIndex(
                name: "IX_VolunteerProfile_TaskDispatchId",
                table: "VolunteerProfile");

            migrationBuilder.DropIndex(
                name: "IX_VolunteerProfile_TaskRequestId",
                table: "VolunteerProfile");

            migrationBuilder.DropColumn(
                name: "TaskDispatchId",
                table: "VolunteerProfile");

            migrationBuilder.DropColumn(
                name: "TaskRequestId",
                table: "VolunteerProfile");
        }
    }
}
