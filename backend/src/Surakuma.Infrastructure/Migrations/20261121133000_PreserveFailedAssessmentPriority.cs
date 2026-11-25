using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Surakuma.Infrastructure.Migrations;

[DbContext(typeof(CrisisDbContext))]
[Migration("20261121133000_PreserveFailedAssessmentPriority")]
public sealed class PreserveFailedAssessmentPriority : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // Recover priorities the previous failure handler reset to High, where the recorded
        // intake or waiting score establishes a higher priority and no staff override exists.
        migrationBuilder.Sql("""
            UPDATE r SET Priority = CASE
                WHEN r.ImmediateDanger = 1 OR r.PriorityScore >= 13 THEN 'Critical' ELSE 'Urgent' END
            FROM dbo.AssistanceRequest AS r
            WHERE r.AssessmentState = 'Failed' AND r.Priority = 'High'
              AND r.Status IN ('Submitted', 'UnderReview', 'Verified', 'Approved', 'InProgress', 'PartiallyFulfilled')
              AND (r.ImmediateDanger = 1 OR r.PriorityScore >= 10
                   OR JSON_VALUE(r.IntakeJson, '$.SafeTonight') = 'No'
                   OR JSON_VALUE(r.IntakeJson, '$.Timing') = 'Now')
              AND NOT EXISTS (SELECT 1 FROM dbo.HumanDecision AS d
                              WHERE d.RequestId = r.Id AND d.Action IN ('Approve', 'Modify'));
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        // Restored urgency is case data. A rollback must preserve subsequent staff decisions.
    }
}
