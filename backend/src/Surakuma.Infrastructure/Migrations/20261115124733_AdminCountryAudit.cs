using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AdminCountryAudit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CountryCode",
                table: "AuditEvent",
                type: "varchar(2)",
                unicode: false,
                maxLength: 2,
                nullable: true);

            // Use the recorded subject, never the actor's current grants, to scope prior activity.
            foreach (var table in new[] { "Crisis", "Membership", "OrganisationCountry", "Resource", "Shelter", "VolunteerProfile", "AdminProposal", "AdminAlert" })
                migrationBuilder.Sql($"""
                    UPDATE a SET a.CountryCode = subject.CountryCode
                    FROM [AuditEvent] a JOIN [{table}] subject ON subject.Id = a.EntityId
                    WHERE a.EntityType = '{table}';
                    """);

            migrationBuilder.Sql("""
                UPDATE a SET a.CountryCode = c.Code
                FROM [AuditEvent] a JOIN [Country] c ON c.Id = a.EntityId WHERE a.EntityType = 'Country';

                UPDATE a SET a.CountryCode = c.CountryCode
                FROM [AuditEvent] a JOIN [AssistanceRequest] r ON r.Id = a.EntityId
                JOIN [Crisis] c ON c.Id = r.CrisisId WHERE a.EntityType = 'AssistanceRequest';
                """);

            foreach (var table in new[] { "OperationalArea", "PublicAlert" })
                migrationBuilder.Sql($"""
                    UPDATE a SET a.CountryCode = c.CountryCode
                    FROM [AuditEvent] a JOIN [{table}] subject ON subject.Id = a.EntityId
                    JOIN [Crisis] c ON c.Id = subject.CrisisId WHERE a.EntityType = '{table}';
                    """);

            foreach (var table in new[] { "Attachment", "Recommendation", "PotentialDuplicate", "ResourceAllocation", "ShelterAllocation", "VolunteerTask", "OutboxMessage" })
                migrationBuilder.Sql($"""
                    UPDATE a SET a.CountryCode = c.CountryCode
                    FROM [AuditEvent] a JOIN [{table}] subject ON subject.Id = a.EntityId
                    JOIN [AssistanceRequest] r ON r.Id = subject.RequestId
                    JOIN [Crisis] c ON c.Id = r.CrisisId WHERE a.EntityType = '{table}';
                    """);

            migrationBuilder.CreateIndex(
                name: "IX_AuditEvent_CountryCode_CreatedAt_Id",
                table: "AuditEvent",
                columns: new[] { "CountryCode", "CreatedAt", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_AuditEvent_CountryCode_CreatedAt_Id",
                table: "AuditEvent");

            migrationBuilder.DropColumn(
                name: "CountryCode",
                table: "AuditEvent");
        }
    }
}
