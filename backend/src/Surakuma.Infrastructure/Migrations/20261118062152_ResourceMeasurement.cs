using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ResourceMeasurement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "RequestQuantity",
                table: "ResourceAllocation",
                type: "decimal(21,5)",
                precision: 21,
                scale: 5,
                nullable: true);

            migrationBuilder.DropCheckConstraint("CK_Request_Quantity", "AssistanceRequest");
            migrationBuilder.AlterColumn<decimal>(
                name: "DeliveredQuantity",
                table: "AssistanceRequest",
                type: "decimal(21,5)",
                precision: 21,
                scale: 5,
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "decimal(18,2)",
                oldPrecision: 18,
                oldScale: 2);
            migrationBuilder.AddCheckConstraint("CK_Request_Quantity", "AssistanceRequest",
                "[Quantity] > 0 AND [DeliveredQuantity] >= 0 AND [DeliveredQuantity] <= [Quantity] AND [HouseholdSize] >= 1");

            migrationBuilder.AddColumn<Guid>(
                name: "AdministrativeDivisionId",
                table: "AssistanceRequest",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Unit",
                table: "AssistanceRequest",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            // The pre-existing placement workflow explicitly defines a valid shelter request as one household.
            migrationBuilder.Sql("EXEC(N'UPDATE [AssistanceRequest] SET [Unit] = N''household'' WHERE [Category] = N''Shelter'' AND [Quantity] = 1;');");

            migrationBuilder.CreateIndex(
                name: "IX_AssistanceRequest_AdministrativeDivisionId",
                table: "AssistanceRequest",
                column: "AdministrativeDivisionId");

            migrationBuilder.AddForeignKey(
                name: "FK_AssistanceRequest_AdministrativeDivision_AdministrativeDivisionId",
                table: "AssistanceRequest",
                column: "AdministrativeDivisionId",
                principalTable: "AdministrativeDivision",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [AssistanceRequest] WHERE [DeliveredQuantity] <> ROUND([DeliveredQuantity], 2)) THROW 51010, 'The previous schema cannot represent converted deliveries.', 1;");
            migrationBuilder.DropForeignKey(
                name: "FK_AssistanceRequest_AdministrativeDivision_AdministrativeDivisionId",
                table: "AssistanceRequest");

            migrationBuilder.DropIndex(
                name: "IX_AssistanceRequest_AdministrativeDivisionId",
                table: "AssistanceRequest");

            migrationBuilder.DropColumn(
                name: "RequestQuantity",
                table: "ResourceAllocation");

            migrationBuilder.DropColumn(
                name: "AdministrativeDivisionId",
                table: "AssistanceRequest");

            migrationBuilder.DropColumn(
                name: "Unit",
                table: "AssistanceRequest");

            migrationBuilder.DropCheckConstraint("CK_Request_Quantity", "AssistanceRequest");
            migrationBuilder.AlterColumn<decimal>(
                name: "DeliveredQuantity",
                table: "AssistanceRequest",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "decimal(21,5)",
                oldPrecision: 21,
                oldScale: 5);
            migrationBuilder.AddCheckConstraint("CK_Request_Quantity", "AssistanceRequest",
                "[Quantity] > 0 AND [DeliveredQuantity] >= 0 AND [DeliveredQuantity] <= [Quantity] AND [HouseholdSize] >= 1");
        }
    }
}
