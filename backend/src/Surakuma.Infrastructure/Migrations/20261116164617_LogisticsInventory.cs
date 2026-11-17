using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class LogisticsInventory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CrisisId",
                table: "StockMovement",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Destination",
                table: "StockMovement",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "OperationId",
                table: "StockMovement",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Origin",
                table: "StockMovement",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "RequestId",
                table: "StockMovement",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Code",
                table: "Resource",
                type: "nvarchar(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "DepotId",
                table: "Resource",
                type: "uniqueidentifier",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "LowStockThreshold",
                table: "Resource",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Depot",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CountryCode = table.Column<string>(type: "varchar(2)", unicode: false, maxLength: 2, nullable: false),
                    OrganisationId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                    Location = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Depot", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Depot_Country_CountryCode",
                        column: x => x.CountryCode,
                        principalTable: "Country",
                        principalColumn: "Code",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Depot_Organisation_OrganisationId",
                        column: x => x.OrganisationId,
                        principalTable: "Organisation",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "LogisticsOrder",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    ResourceId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DestinationResourceId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CrisisId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    OperationalAreaId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Origin = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Destination = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    Quantity = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    ActorId = table.Column<string>(type: "nvarchar(450)", maxLength: 450, nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LogisticsOrder", x => x.Id);
                    table.CheckConstraint("CK_LogisticsOrder_Quantity", "[Quantity] > 0");
                    table.ForeignKey(
                        name: "FK_LogisticsOrder_Crisis_CrisisId",
                        column: x => x.CrisisId,
                        principalTable: "Crisis",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_LogisticsOrder_OperationalArea_OperationalAreaId",
                        column: x => x.OperationalAreaId,
                        principalTable: "OperationalArea",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_LogisticsOrder_Resource_DestinationResourceId",
                        column: x => x.DestinationResourceId,
                        principalTable: "Resource",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_LogisticsOrder_Resource_ResourceId",
                        column: x => x.ResourceId,
                        principalTable: "Resource",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_StockMovement_OperationId",
                table: "StockMovement",
                column: "OperationId");

            migrationBuilder.CreateIndex(
                name: "IX_Resource_CountryCode_DepotId_Code",
                table: "Resource",
                columns: new[] { "CountryCode", "DepotId", "Code" },
                unique: true,
                filter: "[Code] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Resource_DepotId",
                table: "Resource",
                column: "DepotId");

            migrationBuilder.CreateIndex(
                name: "IX_Depot_CountryCode_OrganisationId_Name",
                table: "Depot",
                columns: new[] { "CountryCode", "OrganisationId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Depot_OrganisationId",
                table: "Depot",
                column: "OrganisationId");

            migrationBuilder.CreateIndex(
                name: "IX_LogisticsOrder_CrisisId",
                table: "LogisticsOrder",
                column: "CrisisId");

            migrationBuilder.CreateIndex(
                name: "IX_LogisticsOrder_DestinationResourceId",
                table: "LogisticsOrder",
                column: "DestinationResourceId");

            migrationBuilder.CreateIndex(
                name: "IX_LogisticsOrder_OperationalAreaId",
                table: "LogisticsOrder",
                column: "OperationalAreaId");

            migrationBuilder.CreateIndex(
                name: "IX_LogisticsOrder_ResourceId",
                table: "LogisticsOrder",
                column: "ResourceId");

            migrationBuilder.AddForeignKey(
                name: "FK_Resource_Depot_DepotId",
                table: "Resource",
                column: "DepotId",
                principalTable: "Depot",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Resource_Depot_DepotId",
                table: "Resource");

            migrationBuilder.DropTable(
                name: "Depot");

            migrationBuilder.DropTable(
                name: "LogisticsOrder");

            migrationBuilder.DropIndex(
                name: "IX_StockMovement_OperationId",
                table: "StockMovement");

            migrationBuilder.DropIndex(
                name: "IX_Resource_CountryCode_DepotId_Code",
                table: "Resource");

            migrationBuilder.DropIndex(
                name: "IX_Resource_DepotId",
                table: "Resource");

            migrationBuilder.DropColumn(
                name: "CrisisId",
                table: "StockMovement");

            migrationBuilder.DropColumn(
                name: "Destination",
                table: "StockMovement");

            migrationBuilder.DropColumn(
                name: "OperationId",
                table: "StockMovement");

            migrationBuilder.DropColumn(
                name: "Origin",
                table: "StockMovement");

            migrationBuilder.DropColumn(
                name: "RequestId",
                table: "StockMovement");

            migrationBuilder.DropColumn(
                name: "Code",
                table: "Resource");

            migrationBuilder.DropColumn(
                name: "DepotId",
                table: "Resource");

            migrationBuilder.DropColumn(
                name: "LowStockThreshold",
                table: "Resource");

        }
    }
}
