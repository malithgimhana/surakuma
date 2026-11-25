using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Surakuma.Infrastructure.Migrations;

[DbContext(typeof(CrisisDbContext))]
[Migration("20261123153000_EnableCentreHandoverForExistingSupplyCases")]
public sealed class EnableCentreHandoverForExistingSupplyCases : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            UPDATE r
            SET RequiresCentreHandover = 1, RequiresCoordinatorAuthorization = 1
            FROM dbo.AssistanceRequest AS r
            WHERE r.RequiresCentreHandover = 0
              AND r.Category IN (N'FoodWater', N'Medical')
              AND r.Status IN (N'Submitted', N'UnderReview', N'Verified', N'Approved', N'InProgress')
              AND r.DeliveredQuantity = 0
              AND JSON_QUERY(CASE WHEN ISJSON(r.IntakeJson) = 1 THEN r.IntakeJson ELSE N'{}' END, '$.SupplyItems[0]') IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM dbo.CaseNeed AS item
                  WHERE item.RequestId = r.Id AND item.DeliveredQuantity > 0)
              AND NOT EXISTS (
                  SELECT 1 FROM dbo.ResourceAllocation AS allocation
                  WHERE allocation.RequestId = r.Id AND allocation.Status IN (N'Dispatched', N'Delivered', N'DeliveryException'))
              AND NOT EXISTS (
                  SELECT 1 FROM dbo.VolunteerTask AS task
                  WHERE task.RequestId = r.Id
                    AND task.Status IN (N'Assigned', N'Accepted', N'InProgress', N'AwaitingVerification', N'Returned'));
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        // Leave enabled cases intact because they may already have dispatch and handover records.
    }
}
