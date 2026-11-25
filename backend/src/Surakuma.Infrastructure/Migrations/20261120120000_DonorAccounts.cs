using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Surakuma.Infrastructure.Migrations;

[DbContext(typeof(CrisisDbContext))]
[Migration("20261120120000_DonorAccounts")]
public sealed class DonorAccounts : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        IF NOT EXISTS (SELECT 1 FROM [AspNetRoles] WHERE [NormalizedName] = N'DONOR')
            INSERT INTO [AspNetRoles] ([Id], [Name], [NormalizedName], [ConcurrencyStamp])
            VALUES (N'815b6f1f-021b-46bf-9af9-afda1d49fc4b', N'Donor', N'DONOR', N'815b6f1f-021b-46bf-9af9-afda1d49fc4b');

        INSERT INTO [AspNetUserRoles] ([UserId], [RoleId])
        SELECT profile.[UserId], role.[Id]
        FROM [DonorProfile] AS profile
        CROSS JOIN [AspNetRoles] AS role
        WHERE role.[NormalizedName] = N'DONOR'
            AND NOT EXISTS (SELECT 1 FROM [AspNetUserRoles] AS grantRow
                WHERE grantRow.[UserId] = profile.[UserId] AND grantRow.[RoleId] = role.[Id]);
        """);

    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        DELETE FROM [AspNetRoles] WHERE [Id] = N'815b6f1f-021b-46bf-9af9-afda1d49fc4b';
        """);
}
