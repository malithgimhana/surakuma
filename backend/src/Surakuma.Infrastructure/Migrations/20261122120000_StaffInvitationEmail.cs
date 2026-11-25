using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Surakuma.Infrastructure.Migrations;

[DbContext(typeof(CrisisDbContext))]
[Migration("20261122120000_StaffInvitationEmail")]
public sealed class StaffInvitationEmail : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(name: "Kind", table: "SecurityEmail", type: "nvarchar(50)",
            maxLength: 50, nullable: false, defaultValue: "PasswordReset");
        migrationBuilder.AlterColumn<string>(name: "ProtectedToken", table: "SecurityEmail", type: "nvarchar(max)",
            nullable: false, oldClrType: typeof(string), oldType: "nvarchar(4000)", oldMaxLength: 4000);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("DELETE FROM dbo.SecurityEmail WHERE Kind = 'StaffInvitation';");
        migrationBuilder.DropColumn(name: "Kind", table: "SecurityEmail");
        migrationBuilder.AlterColumn<string>(name: "ProtectedToken", table: "SecurityEmail", type: "nvarchar(4000)",
            maxLength: 4000, nullable: false, oldClrType: typeof(string), oldType: "nvarchar(max)");
    }
}
