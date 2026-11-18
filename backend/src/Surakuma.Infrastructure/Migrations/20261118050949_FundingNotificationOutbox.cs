using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class FundingNotificationOutbox : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "FundingCountryCode",
                table: "OutboxMessage",
                type: "varchar(2)",
                unicode: false,
                maxLength: 2,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_OutboxMessage_FundingCountryCode",
                table: "OutboxMessage",
                column: "FundingCountryCode");

            migrationBuilder.AddForeignKey(
                name: "FK_OutboxMessage_Country_FundingCountryCode",
                table: "OutboxMessage",
                column: "FundingCountryCode",
                principalTable: "Country",
                principalColumn: "Code",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_OutboxMessage_Country_FundingCountryCode",
                table: "OutboxMessage");

            migrationBuilder.DropIndex(
                name: "IX_OutboxMessage_FundingCountryCode",
                table: "OutboxMessage");

            migrationBuilder.DropColumn(
                name: "FundingCountryCode",
                table: "OutboxMessage");
        }
    }
}
