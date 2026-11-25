using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class SequentialPublicReferences : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "dbo");

            migrationBuilder.CreateSequence(
                name: "DSPReferenceNumbers",
                schema: "dbo",
                startValue: 1001L);

            migrationBuilder.CreateSequence(
                name: "RESReferenceNumbers",
                schema: "dbo",
                startValue: 1001L);

            migrationBuilder.CreateSequence(
                name: "SKReferenceNumbers",
                schema: "dbo",
                startValue: 1001L);

            migrationBuilder.CreateSequence(
                name: "SRReferenceNumbers",
                schema: "dbo",
                startValue: 1001L);

            migrationBuilder.CreateSequence(
                name: "TRFReferenceNumbers",
                schema: "dbo",
                startValue: 1001L);

            migrationBuilder.AddColumn<string>(
                name: "LegacyReference",
                table: "SupplyRequest",
                type: "nvarchar(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Reference",
                table: "SupplyRequest",
                type: "nvarchar(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Reference",
                table: "ResourceAllocation",
                type: "nvarchar(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Reference",
                table: "Resource",
                type: "nvarchar(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Reference",
                table: "LogisticsOrder",
                type: "nvarchar(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LegacyReference",
                table: "AssistanceRequest",
                type: "nvarchar(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.DropIndex("IX_AssistanceRequest_Reference", "AssistanceRequest");

            // The dispatch series includes inventory dispatch orders and case allocations in chronological order.
            migrationBuilder.Sql("""
                EXEC(N'
                    WITH NumberedCases AS (
                        SELECT [Id], ROW_NUMBER() OVER (ORDER BY [CreatedAt], [Id]) + 1000 AS [Number]
                        FROM [dbo].[AssistanceRequest]
                    )
                    UPDATE [request]
                    SET [LegacyReference] = [request].[Reference], [Reference] = CONCAT(N''SK-'', [numbered].[Number])
                    FROM [dbo].[AssistanceRequest] [request]
                    JOIN NumberedCases [numbered] ON [numbered].[Id] = [request].[Id];

                    WITH NumberedResources AS (
                        SELECT [Id], ROW_NUMBER() OVER (ORDER BY [CreatedAt], [Id]) + 1000 AS [Number]
                        FROM [dbo].[Resource]
                    )
                    UPDATE [resource]
                    SET [Reference] = CONCAT(N''RES-'', [numbered].[Number])
                    FROM [dbo].[Resource] [resource]
                    JOIN NumberedResources [numbered] ON [numbered].[Id] = [resource].[Id];

                    WITH NumberedSupplyRequests AS (
                        SELECT [Id], ROW_NUMBER() OVER (ORDER BY [CreatedAt], [Id]) + 1000 AS [Number]
                        FROM [dbo].[SupplyRequest]
                    )
                    UPDATE [request]
                    SET [LegacyReference] = CONCAT(N''SR-'', LEFT(UPPER(REPLACE(CONVERT(varchar(36), [request].[Id]), ''-'', '''')), 12)),
                        [Reference] = CONCAT(N''SR-'', [numbered].[Number])
                    FROM [dbo].[SupplyRequest] [request]
                    JOIN NumberedSupplyRequests [numbered] ON [numbered].[Id] = [request].[Id];

                    WITH NumberedTransfers AS (
                        SELECT [Id], ROW_NUMBER() OVER (ORDER BY [CreatedAt], [Id]) + 1000 AS [Number]
                        FROM [dbo].[LogisticsOrder] WHERE [Kind] = ''Transfer''
                    )
                    UPDATE [shipment]
                    SET [Reference] = CONCAT(N''TRF-'', [numbered].[Number])
                    FROM [dbo].[LogisticsOrder] [shipment]
                    JOIN NumberedTransfers [numbered] ON [numbered].[Id] = [shipment].[Id];

                    SELECT [Id], [CaseAllocation], ROW_NUMBER() OVER (ORDER BY [CreatedAt], [Id], [CaseAllocation]) + 1000 AS [Number]
                    INTO #NumberedDispatches
                    FROM (
                        SELECT [Id], [CreatedAt], 0 AS [CaseAllocation] FROM [dbo].[LogisticsOrder] WHERE [Kind] <> ''Transfer''
                        UNION ALL
                        SELECT [Id], [CreatedAt], 1 AS [CaseAllocation] FROM [dbo].[ResourceAllocation]
                    ) [dispatch];

                    UPDATE [shipment]
                    SET [Reference] = CONCAT(N''DSP-'', [numbered].[Number])
                    FROM [dbo].[LogisticsOrder] [shipment]
                    JOIN #NumberedDispatches [numbered] ON [numbered].[Id] = [shipment].[Id] AND [numbered].[CaseAllocation] = 0;

                    UPDATE [allocation]
                    SET [Reference] = CONCAT(N''DSP-'', [numbered].[Number])
                    FROM [dbo].[ResourceAllocation] [allocation]
                    JOIN #NumberedDispatches [numbered] ON [numbered].[Id] = [allocation].[Id] AND [numbered].[CaseAllocation] = 1;

                    DECLARE @restart nvarchar(max) = CONCAT(
                        N''ALTER SEQUENCE [dbo].[SKReferenceNumbers] RESTART WITH '', 1001 + (SELECT COUNT_BIG(*) FROM [dbo].[AssistanceRequest]), N'';'',
                        N''ALTER SEQUENCE [dbo].[RESReferenceNumbers] RESTART WITH '', 1001 + (SELECT COUNT_BIG(*) FROM [dbo].[Resource]), N'';'',
                        N''ALTER SEQUENCE [dbo].[SRReferenceNumbers] RESTART WITH '', 1001 + (SELECT COUNT_BIG(*) FROM [dbo].[SupplyRequest]), N'';'',
                        N''ALTER SEQUENCE [dbo].[TRFReferenceNumbers] RESTART WITH '', 1001 + (SELECT COUNT_BIG(*) FROM [dbo].[LogisticsOrder] WHERE [Kind] = ''Transfer''), N'';'',
                        N''ALTER SEQUENCE [dbo].[DSPReferenceNumbers] RESTART WITH '', 1001 + (SELECT COUNT_BIG(*) FROM #NumberedDispatches), N'';''
                    );
                    EXEC sys.sp_executesql @restart;
                ');
                """);

            foreach (var table in new[] { "SupplyRequest", "ResourceAllocation", "Resource", "LogisticsOrder" })
            {
                migrationBuilder.AlterColumn<string>(
                    name: "Reference", table: table, type: "nvarchar(30)", maxLength: 30, nullable: false,
                    oldClrType: typeof(string), oldType: "nvarchar(30)", oldMaxLength: 30, oldNullable: true);
            }

            migrationBuilder.CreateIndex(
                name: "IX_AssistanceRequest_Reference",
                table: "AssistanceRequest",
                column: "Reference",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SupplyRequest_Reference",
                table: "SupplyRequest",
                column: "Reference",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ResourceAllocation_Reference",
                table: "ResourceAllocation",
                column: "Reference",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Resource_Reference",
                table: "Resource",
                column: "Reference",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LogisticsOrder_Reference",
                table: "LogisticsOrder",
                column: "Reference",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AssistanceRequest_LegacyReference",
                table: "AssistanceRequest",
                column: "LegacyReference",
                unique: true,
                filter: "[LegacyReference] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SupplyRequest_Reference",
                table: "SupplyRequest");

            migrationBuilder.DropIndex(
                name: "IX_ResourceAllocation_Reference",
                table: "ResourceAllocation");

            migrationBuilder.DropIndex(
                name: "IX_Resource_Reference",
                table: "Resource");

            migrationBuilder.DropIndex(
                name: "IX_LogisticsOrder_Reference",
                table: "LogisticsOrder");

            migrationBuilder.DropIndex(
                name: "IX_AssistanceRequest_LegacyReference",
                table: "AssistanceRequest");

            migrationBuilder.DropIndex("IX_AssistanceRequest_Reference", "AssistanceRequest");
            migrationBuilder.Sql("""
                EXEC(N'
                    UPDATE [request] SET [Reference] = [LegacyReference]
                    FROM [dbo].[AssistanceRequest] [request]
                    WHERE [LegacyReference] IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM [dbo].[AssistanceRequest] [newCase]
                        WHERE [newCase].[LegacyReference] IS NULL AND [newCase].[Reference] = [request].[LegacyReference]
                    );
                ');
                """);
            migrationBuilder.CreateIndex(
                name: "IX_AssistanceRequest_Reference",
                table: "AssistanceRequest",
                column: "Reference",
                unique: true);

            migrationBuilder.DropColumn(
                name: "LegacyReference",
                table: "SupplyRequest");

            migrationBuilder.DropColumn(
                name: "Reference",
                table: "SupplyRequest");

            migrationBuilder.DropColumn(
                name: "Reference",
                table: "ResourceAllocation");

            migrationBuilder.DropColumn(
                name: "Reference",
                table: "Resource");

            migrationBuilder.DropColumn(
                name: "Reference",
                table: "LogisticsOrder");

            migrationBuilder.DropColumn(
                name: "LegacyReference",
                table: "AssistanceRequest");

            migrationBuilder.DropSequence(
                name: "DSPReferenceNumbers",
                schema: "dbo");

            migrationBuilder.DropSequence(
                name: "RESReferenceNumbers",
                schema: "dbo");

            migrationBuilder.DropSequence(
                name: "SKReferenceNumbers",
                schema: "dbo");

            migrationBuilder.DropSequence(
                name: "SRReferenceNumbers",
                schema: "dbo");

            migrationBuilder.DropSequence(
                name: "TRFReferenceNumbers",
                schema: "dbo");
        }
    }
}
