using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
namespace Surakuma.Infrastructure.Migrations;

[DbContext(typeof(CrisisDbContext))]
[Migration("20261107130000_CrisisCentreRouting")]
public sealed class CrisisCentreRouting : Migration
{
    protected override void Up(MigrationBuilder m)
    {
        m.AddColumn<Guid>(name: "PrimaryOrganisationId", table: "Crisis", type: "uniqueidentifier", nullable: true);
        m.AddColumn<bool>(name: "AvailableForAssignment", table: "Membership", type: "bit", nullable: false, defaultValue: false);
        m.AddColumn<string>(name: "AssignedCaseManagerId", table: "AssistanceRequest", type: "nvarchar(450)", maxLength: 450, nullable: true);
        m.CreateIndex("IX_Crisis_PrimaryOrganisationId", "Crisis", "PrimaryOrganisationId");
        m.CreateIndex("IX_AssistanceRequest_AssignedCaseManagerId", "AssistanceRequest", "AssignedCaseManagerId");
        m.AddForeignKey("FK_Crisis_Organisation_PrimaryOrganisationId", "Crisis", "PrimaryOrganisationId", "Organisation", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
        m.AddForeignKey("FK_AssistanceRequest_AspNetUsers_AssignedCaseManagerId", "AssistanceRequest", "AssignedCaseManagerId", "AspNetUsers", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
    }
    protected override void Down(MigrationBuilder m)
    {
        m.DropForeignKey("FK_Crisis_Organisation_PrimaryOrganisationId", "Crisis");
        m.DropForeignKey("FK_AssistanceRequest_AspNetUsers_AssignedCaseManagerId", "AssistanceRequest");
        m.DropIndex("IX_Crisis_PrimaryOrganisationId", "Crisis");
        m.DropIndex("IX_AssistanceRequest_AssignedCaseManagerId", "AssistanceRequest");
        m.DropColumn("PrimaryOrganisationId", "Crisis");
        m.DropColumn("AvailableForAssignment", "Membership");
        m.DropColumn("AssignedCaseManagerId", "AssistanceRequest");
    }
}
