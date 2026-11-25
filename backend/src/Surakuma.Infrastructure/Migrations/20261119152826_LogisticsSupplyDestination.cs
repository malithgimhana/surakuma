using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class LogisticsSupplyDestination : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "DestinationResourceId",
                table: "SupplyRequest",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_SupplyRequest_DestinationResourceId",
                table: "SupplyRequest",
                column: "DestinationResourceId");

            migrationBuilder.AddForeignKey(
                name: "FK_SupplyRequest_Resource_DestinationResourceId",
                table: "SupplyRequest",
                column: "DestinationResourceId",
                principalTable: "Resource",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_SupplyRequest_Resource_DestinationResourceId",
                table: "SupplyRequest");

            migrationBuilder.DropIndex(
                name: "IX_SupplyRequest_DestinationResourceId",
                table: "SupplyRequest");

            migrationBuilder.DropColumn(
                name: "DestinationResourceId",
                table: "SupplyRequest");
        }
    }
}
