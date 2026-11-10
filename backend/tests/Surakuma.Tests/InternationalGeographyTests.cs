using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class InternationalGeographyTests
{
    [Fact]
    public void ExistingOperationalObjectsDefaultToSriLanka()
    {
        Assert.Equal("LK", new Crisis().CountryCode);
        Assert.Equal("LK", new Resource().CountryCode);
        Assert.Equal("LK", new Shelter().CountryCode);
    }

    [Fact]
    public void MigrationSeedsCountriesBeforeAddingOperationalForeignKeys()
    {
        using var db = new CrisisDbContext(new DbContextOptionsBuilder<CrisisDbContext>()
            .UseSqlServer("Server=localhost;Database=Unused;Trusted_Connection=True;TrustServerCertificate=True")
            .Options);
        var sql = db.GetService<IMigrator>().GenerateScript("20261107130000_CrisisCentreRouting", "20261110153723_InternationalGeography");
        var seed = sql.IndexOf("INSERT INTO [Country]", StringComparison.Ordinal);
        var foreignKey = sql.IndexOf("FK_Crisis_Country_CountryCode", StringComparison.Ordinal);
        Assert.True(seed >= 0 && foreignKey > seed);
        Assert.Contains("'LK'", sql);
        Assert.Contains("'NP'", sql);
        Assert.Contains("'IN'", sql);
        Assert.Contains("INSERT INTO [OrganisationCountry]", sql);
    }
}
