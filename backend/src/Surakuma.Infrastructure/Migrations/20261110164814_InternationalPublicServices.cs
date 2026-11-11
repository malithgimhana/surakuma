using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Surakuma.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InternationalPublicServices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TranslationsJson",
                table: "PublicAlert",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "EmergencyContactsJson",
                table: "Country",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Languages",
                table: "Country",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "RequiredAlertLanguages",
                table: "Country",
                type: "nvarchar(4000)",
                maxLength: 4000,
                nullable: false,
                defaultValue: "");
            migrationBuilder.Sql(@"UPDATE [Country] SET [Languages]='en,si,ta', [RequiredAlertLanguages]='en,si,ta', [EmergencyContactsJson]=N'[{""label"": ""Police emergency"", ""number"": ""119"", ""sourceUrl"": ""https://www.police.lk/?page_id=1334""}, {""label"": ""Ambulance"", ""number"": ""1990"", ""sourceUrl"": ""https://www.1990.lk/""}]' WHERE [Code]='LK';
UPDATE [Country] SET [Languages]='en,ne', [RequiredAlertLanguages]='en', [EmergencyContactsJson]=N'[{""label"": ""Police emergency"", ""number"": ""100"", ""sourceUrl"": ""https://ncb.nepalpolice.gov.np/safety-and-security/""}]' WHERE [Code]='NP';
UPDATE [Country] SET [Languages]='en,hi,ta', [RequiredAlertLanguages]='en', [EmergencyContactsJson]=N'[{""label"": ""Emergency response"", ""number"": ""112"", ""sourceUrl"": ""https://www.mha.gov.in/emergency-response-support-system-erss""}]' WHERE [Code]='IN';
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Ampara' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Ampara','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Anuradhapura' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Anuradhapura','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Badulla' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Badulla','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Batticaloa' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Batticaloa','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Colombo' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Colombo','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Galle' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Galle','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Gampaha' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Gampaha','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Hambantota' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Hambantota','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Jaffna' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Jaffna','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Kalutara' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Kalutara','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Kandy' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Kandy','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Kegalle' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Kegalle','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Kilinochchi' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Kilinochchi','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Kurunegala' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Kurunegala','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Mannar' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Mannar','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Matale' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Matale','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Matara' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Matara','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Monaragala' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Monaragala','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Mullaitivu' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Mullaitivu','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Nuwara Eliya' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Nuwara Eliya','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Polonnaruwa' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Polonnaruwa','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Puttalam' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Puttalam','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Ratnapura' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Ratnapura','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Trincomalee' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Trincomalee','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='LK' AND [Name]=N'Vavuniya' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'LK',N'Vavuniya','District',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='NP' AND [Name]=N'Koshi' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'NP',N'Koshi','Province',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='NP' AND [Name]=N'Madhesh' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'NP',N'Madhesh','Province',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='NP' AND [Name]=N'Bagmati' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'NP',N'Bagmati','Province',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='NP' AND [Name]=N'Gandaki' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'NP',N'Gandaki','Province',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='NP' AND [Name]=N'Lumbini' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'NP',N'Lumbini','Province',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='NP' AND [Name]=N'Karnali' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'NP',N'Karnali','Province',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='NP' AND [Name]=N'Sudurpashchim' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'NP',N'Sudurpashchim','Province',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Andhra Pradesh' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Andhra Pradesh','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Arunachal Pradesh' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Arunachal Pradesh','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Assam' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Assam','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Bihar' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Bihar','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Chhattisgarh' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Chhattisgarh','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Goa' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Goa','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Gujarat' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Gujarat','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Haryana' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Haryana','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Himachal Pradesh' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Himachal Pradesh','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Jharkhand' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Jharkhand','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Karnataka' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Karnataka','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Kerala' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Kerala','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Madhya Pradesh' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Madhya Pradesh','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Maharashtra' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Maharashtra','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Manipur' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Manipur','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Meghalaya' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Meghalaya','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Mizoram' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Mizoram','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Nagaland' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Nagaland','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Odisha' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Odisha','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Punjab' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Punjab','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Rajasthan' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Rajasthan','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Sikkim' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Sikkim','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Tamil Nadu' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Tamil Nadu','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Telangana' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Telangana','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Tripura' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Tripura','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Uttar Pradesh' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Uttar Pradesh','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Uttarakhand' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Uttarakhand','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'West Bengal' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'West Bengal','State',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Andaman and Nicobar Islands' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Andaman and Nicobar Islands','Union territory',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Chandigarh' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Chandigarh','Union territory',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Dadra and Nagar Haveli and Daman and Diu' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Dadra and Nagar Haveli and Daman and Diu','Union territory',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Delhi' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Delhi','Union territory',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Jammu and Kashmir' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Jammu and Kashmir','Union territory',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Ladakh' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Ladakh','Union territory',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Lakshadweep' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Lakshadweep','Union territory',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());
IF NOT EXISTS (SELECT 1 FROM [AdministrativeDivision] WHERE [CountryCode]='IN' AND [Name]=N'Puducherry' AND [ParentId] IS NULL) INSERT INTO [AdministrativeDivision] ([Id],[CountryCode],[Name],[LevelName],[CreatedAt],[UpdatedAt]) VALUES (NEWID(),'IN',N'Puducherry','Union territory',SYSDATETIMEOFFSET(),SYSDATETIMEOFFSET());");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TranslationsJson",
                table: "PublicAlert");

            migrationBuilder.DropColumn(
                name: "EmergencyContactsJson",
                table: "Country");

            migrationBuilder.DropColumn(
                name: "Languages",
                table: "Country");

            migrationBuilder.DropColumn(
                name: "RequiredAlertLanguages",
                table: "Country");
        }
    }
}
