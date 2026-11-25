using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Surakuma.Infrastructure.Migrations;

[DbContext(typeof(CrisisDbContext))]
[Migration("20261122162000_PendingPartnerReviewNotifications")]
public sealed class PendingPartnerReviewNotifications : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            INSERT INTO dbo.Notification (Id, EventId, UserId, IsInternal, ScopeOrganisationId, ScopeCountryCode,
                ScopeRole, Message, SinhalaMessage, TamilMessage, [Read], CreatedAt, UpdatedAt)
            SELECT NEWID(), registration.Id, reviewer.Id, 1, organisation.Id, registration.CountryCode, N'Administrator',
                CONCAT(N'Verification evidence was submitted for ', organisation.Name, N' in ', country.Name, N'.'),
                N'', N'', 0, SYSUTCDATETIME(), SYSUTCDATETIME()
            FROM dbo.OrganisationCountry AS registration
            JOIN dbo.Organisation AS organisation ON organisation.Id = registration.OrganisationId
            JOIN dbo.Country AS country ON country.Code = registration.CountryCode
            CROSS JOIN dbo.AspNetUsers AS reviewer
            WHERE organisation.ArchivedAt IS NULL AND registration.ArchivedAt IS NULL
              AND registration.VerificationState = N'Pending' AND LEN(TRIM(registration.Evidence)) > 0
              AND reviewer.IsSystemAdministrator = 1 AND reviewer.Disabled = 0
              AND NOT EXISTS (
                  SELECT 1 FROM dbo.Notification AS existing
                  WHERE existing.UserId = reviewer.Id AND (existing.EventId = registration.Id
                      OR (existing.ScopeOrganisationId = organisation.Id
                          AND existing.ScopeCountryCode = registration.CountryCode
                          AND existing.ScopeRole = N'Administrator'
                          AND existing.Message LIKE N'Verification evidence was submitted for %'))
              );
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            DELETE notification
            FROM dbo.Notification AS notification
            JOIN dbo.OrganisationCountry AS registration ON registration.Id = notification.EventId
            WHERE notification.ScopeRole = N'Administrator'
              AND notification.ScopeOrganisationId = registration.OrganisationId
              AND notification.ScopeCountryCode = registration.CountryCode;
            """);
    }
}
