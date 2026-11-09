using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
namespace Surakuma.Infrastructure.Migrations;

[DbContext(typeof(CrisisDbContext))]
[Migration("20261107120000_OptionalRequestOrganisation")]
public sealed class OptionalRequestOrganisation : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropForeignKey("FK_AssistanceRequest_Organisation_OrganisationId", "AssistanceRequest");
        migrationBuilder.AlterColumn<Guid>(name: "OrganisationId", table: "AssistanceRequest", type: "uniqueidentifier", nullable: true, oldClrType: typeof(Guid), oldType: "uniqueidentifier");
        migrationBuilder.AddColumn<string>(name: "AssignmentStatus", table: "AssistanceRequest", type: "nvarchar(50)", maxLength: 50, nullable: false, defaultValue: "Claimed");
        migrationBuilder.AddColumn<bool>(name: "RequestedForSomeoneElse", table: "AssistanceRequest", type: "bit", nullable: false, defaultValue: false);
        migrationBuilder.AddColumn<string>(name: "RequesterRelationship", table: "AssistanceRequest", type: "nvarchar(4000)", maxLength: 4000, nullable: false, defaultValue: "");
        migrationBuilder.AddColumn<string>(name: "RequesterContact", table: "AssistanceRequest", type: "nvarchar(4000)", maxLength: 4000, nullable: false, defaultValue: "");
        migrationBuilder.AddForeignKey("FK_AssistanceRequest_Organisation_OrganisationId", "AssistanceRequest", "OrganisationId", "Organisation", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("IF EXISTS (SELECT 1 FROM [AssistanceRequest] WHERE [OrganisationId] IS NULL) THROW 51000, 'Assign all requests before rolling back this migration.', 1;");
        migrationBuilder.DropForeignKey("FK_AssistanceRequest_Organisation_OrganisationId", "AssistanceRequest");
        migrationBuilder.DropColumn("AssignmentStatus", "AssistanceRequest");
        migrationBuilder.DropColumn("RequestedForSomeoneElse", "AssistanceRequest");
        migrationBuilder.DropColumn("RequesterRelationship", "AssistanceRequest");
        migrationBuilder.DropColumn("RequesterContact", "AssistanceRequest");
        migrationBuilder.AlterColumn<Guid>(name: "OrganisationId", table: "AssistanceRequest", type: "uniqueidentifier", nullable: false, oldClrType: typeof(Guid), oldType: "uniqueidentifier", oldNullable: true);
        migrationBuilder.AddForeignKey("FK_AssistanceRequest_Organisation_OrganisationId", "AssistanceRequest", "OrganisationId", "Organisation", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
    }
}
