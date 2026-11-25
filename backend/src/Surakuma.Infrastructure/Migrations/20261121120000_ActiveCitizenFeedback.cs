using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Surakuma.Infrastructure.Migrations;

[DbContext(typeof(CrisisDbContext))]
[Migration("20261121120000_ActiveCitizenFeedback")]
public sealed class ActiveCitizenFeedback : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<bool>("IsSuperseded", "Feedback", type: "bit", nullable: false, defaultValue: false);
        // Keep every historical submission. Preserve an existing delivery problem as the active record.
        migrationBuilder.Sql("""
            DECLARE @duplicates bigint;
            SELECT @duplicates = COALESCE(SUM(Entries - 1), 0)
            FROM (SELECT COUNT_BIG(*) AS Entries FROM dbo.Feedback GROUP BY RequestId, UserId HAVING COUNT_BIG(*) > 1) AS duplicateGroups;
            PRINT CONCAT('Historical feedback rows retained as superseded: ', @duplicates);

            WITH Ranked AS (
                SELECT Id, IsSuperseded,
                       ROW_NUMBER() OVER (PARTITION BY RequestId, UserId ORDER BY Problem DESC, CreatedAt, Id) AS EntryOrder
                FROM dbo.Feedback
            )
            UPDATE Ranked SET IsSuperseded = 1 WHERE EntryOrder > 1;
            """);
        migrationBuilder.DropIndex("IX_Feedback_RequestId", "Feedback");
        migrationBuilder.CreateIndex("IX_Feedback_RequestId_UserId", "Feedback", new[] { "RequestId", "UserId" },
            unique: true, filter: "[IsSuperseded] = 0");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex("IX_Feedback_RequestId_UserId", "Feedback");
        migrationBuilder.CreateIndex("IX_Feedback_RequestId", "Feedback", "RequestId");
        migrationBuilder.DropColumn("IsSuperseded", "Feedback");
    }
}
