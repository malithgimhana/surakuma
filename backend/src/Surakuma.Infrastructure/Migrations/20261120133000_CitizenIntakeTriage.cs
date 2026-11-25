using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Surakuma.Infrastructure.Migrations;

[DbContext(typeof(CrisisDbContext))]
[Migration("20261120133000_CitizenIntakeTriage")]
public sealed class CitizenIntakeTriage : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        const string table = "AssistanceRequest";
        migrationBuilder.AddColumn<string>("IntakeJson", table, "nvarchar(4000)", maxLength: 4000, nullable: true);
        migrationBuilder.AddColumn<decimal>("IntakeScore", table, "decimal(4,1)", nullable: true, precision: 4, scale: 1);
        migrationBuilder.AddColumn<decimal>("PriorityScore", table, "decimal(4,1)", nullable: true, precision: 4, scale: 1);
        migrationBuilder.AddColumn<DateTimeOffset>("NextPriorityEscalationAt", table, "datetimeoffset", nullable: true);
        migrationBuilder.AddColumn<bool>("ImmediateDanger", table, "bit", nullable: false, defaultValue: false);
        migrationBuilder.AddColumn<string>("AssessmentState", table, "nvarchar(20)", maxLength: 20, nullable: true);
        migrationBuilder.CreateIndex("IX_AssistanceRequest_NextPriorityEscalationAt", table, "NextPriorityEscalationAt",
            filter: "[NextPriorityEscalationAt] IS NOT NULL");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        const string table = "AssistanceRequest";
        migrationBuilder.DropIndex("IX_AssistanceRequest_NextPriorityEscalationAt", table);
        foreach (var column in new[] { "IntakeJson", "IntakeScore", "PriorityScore", "NextPriorityEscalationAt", "ImmediateDanger", "AssessmentState" })
            migrationBuilder.DropColumn(column, table);
    }
}
