using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class QuantityConversionTests
{
    [Theory]
    [InlineData(2, "kilograms", "g", 2000)]
    [InlineData(1500, "grams", "kg", 1.5)]
    [InlineData(15, "L", "mL", 15000)]
    [InlineData(15000, "millilitres", "litres", 15)]
    [InlineData(3, "items", "pieces", 3)]
    public void ConvertsOnlyEquivalentMeasurements(double quantity, string from, string to, double expected) =>
        Assert.Equal((decimal)expected, QuantityUnits.Convert((decimal)quantity, from, to));

    [Theory]
    [InlineData("packs", "pieces")]
    [InlineData("kg", "L")]
    [InlineData("persons", "household")]
    [InlineData("kits", "packs")]
    [InlineData(null, "l")]
    public void RejectsIncompatibleOrUnknownUnits(string? from, string to) =>
        Assert.Throws<RuleException>(() => QuantityUnits.Convert(1m, from, to));

    [Fact]
    public void ConfiguredCountUnitHasNoImplicitConversionAndInexactStockIsRejected()
    {
        var catalog = new ResourceUnitCatalog([new("blanket-bales", "Blanket bales", false)]);
        Assert.Equal("blanket-bales", catalog.Require("Blanket-Bales"));
        Assert.Throws<RuleException>(() => catalog.Require("unconfigured"));
        Assert.Throws<RuleException>(() => QuantityUnits.ValidateInventory(1.5m, "blanket-bales"));
        Assert.Throws<RuleException>(() => QuantityUnits.ForInventory(1m, "mL", "L"));
        Assert.Equal(0.001m, QuantityUnits.Convert(1m, "mL", "L"));
    }
}

public sealed class ResourceMeasurementTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Theory]
    [InlineData("l", 15)]
    [InlineData("ml", 15000)]
    public async Task WaterReservationAndPartialReceiptUseTheirOwnUnits(string stockUnit, int physicalQuantity)
    {
        using var citizen = await fixture.Login("citizen");
        using var manager = await fixture.Login("case");
        using var logistics = await fixture.Login("logistics");
        var (crisis, organisation, region, _) = await Geography();
        var aid = await Post(citizen, "/api/v1/requests", Submission(crisis, region, "litres"));
        var requestId = Id(aid);
        Assert.Equal("l", aid.GetProperty("unit").GetString());
        Assert.Equal(region, aid.GetProperty("administrativeDivisionId").GetGuid());
        await Approve(manager, requestId);
        var stocked = Id(await Post(logistics, "/api/v1/resources", Inventory(organisation, stockUnit, physicalQuantity)));
        var packStock = Id(await Post(logistics, "/api/v1/resources", Inventory(organisation, "packs", 100)));
        var recommendations = await logistics.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{requestId}/allocation-recommendations");
        var candidate = Assert.Single(recommendations.GetProperty("candidates").EnumerateArray());
        Assert.Equal(15m, candidate.GetProperty("availableInRequestUnit").GetDecimal());
        Assert.Equal(5m, candidate.GetProperty("remainingAfterReservation").GetDecimal());
        Assert.True(recommendations.GetProperty("shortage").GetBoolean());
        var shortage = await logistics.GetFromJsonAsync<JsonElement>("/api/v1/requests?view=shortages");
        Assert.Contains(shortage.GetProperty("items").EnumerateArray(), row => Id(row) == requestId);

        var reservation = new { requestId, resourceId = stocked, quantity = physicalQuantity };
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync("/api/v1/allocations",
            reservation with { resourceId = packStock })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync("/api/v1/allocations",
            reservation with { quantity = physicalQuantity + 1 })).StatusCode);
        var shipment = await Post(logistics, "/api/v1/allocations", reservation);
        Assert.Equal(15m, shipment.GetProperty("requestQuantity").GetDecimal());
        await Deliver(logistics, Id(shipment), physicalQuantity);
        var detail = await citizen.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{requestId}");
        var request = detail.GetProperty("request");
        Assert.Equal("PartiallyFulfilled", request.GetProperty("status").GetString());
        Assert.Equal(5m, request.GetProperty("quantity").GetDecimal() - request.GetProperty("deliveredQuantity").GetDecimal());
        var savedReceipt = Assert.Single(detail.GetProperty("allocations").EnumerateArray());
        Assert.Equal(stockUnit, savedReceipt.GetProperty("unit").GetString());
        Assert.Equal(physicalQuantity, savedReceipt.GetProperty("confirmedQuantity").GetDecimal());
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        Assert.Equal(0m, (await db.Set<Resource>().AsNoTracking().SingleAsync(r => r.Id == stocked)).Stock);
        Assert.Equal(physicalQuantity, (await db.Set<StockMovement>().SingleAsync(m => m.ResourceId == stocked && m.Kind == "Deliver")).Quantity);
    }

    [Fact]
    public async Task CompetingReservationsFromDifferentStockRowsCannotOvercommitCase()
    {
        using var citizen = await fixture.Login("citizen");
        using var manager = await fixture.Login("case");
        using var firstLogistics = await fixture.Login("logistics");
        using var secondLogistics = await fixture.Login("logistics");
        var (crisis, organisation, region, _) = await Geography();
        var requestId = Id(await Post(citizen, "/api/v1/requests", Submission(crisis, region, "l")));
        await Approve(manager, requestId);
        var firstStock = Id(await Post(firstLogistics, "/api/v1/resources", Inventory(organisation, "l", 15)));
        var secondStock = Id(await Post(secondLogistics, "/api/v1/resources", Inventory(organisation, "ml", 15000)));
        var results = await Task.WhenAll(
            firstLogistics.PostAsJsonAsync("/api/v1/allocations", new { requestId, resourceId = firstStock, quantity = 15 }),
            secondLogistics.PostAsJsonAsync("/api/v1/allocations", new { requestId, resourceId = secondStock, quantity = 15000 }));
        Assert.Single(results, r => r.IsSuccessStatusCode);
        Assert.Single(results, r => r.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.Conflict);
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var allocation = await db.Set<ResourceAllocation>().SingleAsync(a => a.RequestId == requestId);
        Assert.Equal(15m, allocation.RequestQuantity);
        var stocks = await db.Set<Resource>().Where(r => r.Id == firstStock || r.Id == secondStock).ToListAsync();
        Assert.Equal(15m, stocks.Sum(s => QuantityUnits.Convert(s.Reserved, s.Unit, "l")));
        await Deliver(firstLogistics, allocation.Id, allocation.Quantity);
        var other = Id(await Post(citizen, "/api/v1/requests", Submission(crisis, region, "l")));
        await Approve(manager, other);
        var remaining = stocks.Single(s => s.Id != allocation.ResourceId);
        var next = Id(await Post(firstLogistics, "/api/v1/allocations", new { requestId = other, resourceId = remaining.Id, quantity = remaining.Available }));
        await Deliver(firstLogistics, next, remaining.Available);
    }

    [Fact]
    public async Task LegacyRequestNeedsScopedClarificationAndCountryRegionValidation()
    {
        using var citizen = await fixture.Login("citizen");
        using var manager = await fixture.Login("case");
        using var logistics = await fixture.Login("logistics");
        var (crisis, organisation, localRegion, foreignRegion) = await Geography();
        Assert.Equal(HttpStatusCode.BadRequest, (await citizen.PostAsJsonAsync("/api/v1/requests", Submission(crisis, foreignRegion, "l"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await citizen.PostAsJsonAsync("/api/v1/requests", Submission(crisis, localRegion, null))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await citizen.PostAsJsonAsync("/api/v1/requests", Submission(crisis, localRegion, "bottles"))).StatusCode);
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var seed = await db.Set<AssistanceRequest>().SingleAsync(r => r.SubmissionKey == "seed-food");
        var legacy = new AssistanceRequest { CitizenId = seed.CitizenId, OrganisationId = organisation, CrisisId = crisis,
            Category = AidCategory.FoodWater, Quantity = 20, Status = RequestStatus.Approved, SubmissionKey = Guid.NewGuid().ToString() };
        db.Add(legacy);
        await db.SaveChangesAsync();
        var path = $"/api/v1/requests/{legacy.Id}";
        var recommendation = await logistics.GetFromJsonAsync<JsonElement>(path + "/allocation-recommendations");
        Assert.True(recommendation.GetProperty("unitRequiresClarification").GetBoolean());
        Assert.Empty(recommendation.GetProperty("candidates").EnumerateArray());
        var stock = Id(await Post(logistics, "/api/v1/resources", Inventory(organisation, "ml", 100)));
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync("/api/v1/allocations",
            new { requestId = legacy.Id, resourceId = stock, quantity = 0.01m })).StatusCode);
        var clarification = new { unit = "l", administrativeDivisionId = localRegion, reason = "Confirmed with synthetic citizen records." };
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.PatchAsJsonAsync(path + "/measurement", clarification)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await manager.PatchAsJsonAsync(path + "/measurement",
            clarification with { administrativeDivisionId = foreignRegion })).StatusCode);
        (await manager.PatchAsJsonAsync(path + "/measurement", clarification)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest, (await manager.PatchAsJsonAsync(path + "/measurement", clarification with { unit = "packs" })).StatusCode);
        var confirmed = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(r => r.Id == legacy.Id);
        Assert.Equal("l", confirmed.Unit);
        Assert.Equal(20m, confirmed.Quantity);
        Assert.Equal(localRegion, confirmed.AdministrativeDivisionId);
        Assert.Single(await db.Set<AuditEvent>().Where(a => a.EntityId == legacy.Id &&
            a.Action == "RequestMeasurementClarified" && a.CountryCode == "LK").ToListAsync());
        var ship = Id(await Post(logistics, "/api/v1/allocations", new { requestId = legacy.Id, resourceId = stock, quantity = 0.01m }));
        await Deliver(logistics, ship, 0.01m);
        Assert.Equal(0.00001m, await db.Set<AssistanceRequest>().Where(r => r.Id == legacy.Id).Select(r => r.DeliveredQuantity).SingleAsync());
        // Consume the unused stock through the normal path so this fixture does not affect the water-shortage cases.
        var remainder = Id(await Post(logistics, "/api/v1/allocations", new { requestId = legacy.Id, resourceId = stock, quantity = 99.99m }));
        await Deliver(logistics, remainder, 99.99m);
    }

    [Fact]
    public async Task ForecastGroupsVolumeSeparatelyFromPacksAndUnknownLegacyUnits()
    {
        using var coordinator = await fixture.Login("coordinator");
        var (crisis, organisation, region, _) = await Geography();
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var citizen = await db.Set<AssistanceRequest>().Where(r => r.SubmissionKey == "seed-food").Select(r => r.CitizenId).SingleAsync();
        var samples = new (string? Unit, decimal Quantity)[] { ("l", 2), ("ml", 1500), ("packs", 3), (null, 6) };
        foreach (var sample in samples)
            db.Add(new AssistanceRequest { CitizenId = citizen, CrisisId = crisis, OrganisationId = organisation,
                AdministrativeDivisionId = region, Category = AidCategory.FoodWater, Unit = sample.Unit, Quantity = sample.Quantity,
                CreatedAt = DateTimeOffset.UtcNow.AddDays(-7), SubmissionKey = Guid.NewGuid().ToString(), Synthetic = true });
        await db.SaveChangesAsync();
        var forecast = await Post(coordinator, $"/api/v1/crises/{crisis}/decision-support/forecasts?countryCode=LK", new { category = "FoodWater" });
        var evidence = forecast.GetProperty("evidence");
        Assert.Equal(1, evidence.GetProperty("unknownUnitRequests").GetInt32());
        Assert.All(evidence.GetProperty("weeks").EnumerateArray(), w => Assert.Equal(JsonValueKind.Null, w.GetProperty("requested").ValueKind));
        var groups = evidence.GetProperty("groups").EnumerateArray().ToDictionary(g => g.GetProperty("unit").GetString()!);
        Assert.Equal(2, groups.Count);
        Assert.Equal(region, groups["ml"].GetProperty("regionId").GetGuid());
        Assert.Equal(3500m, groups["ml"].GetProperty("weeks").EnumerateArray().Sum(w => w.GetProperty("requested").GetDecimal()));
        Assert.Equal(3m, groups["packs"].GetProperty("weeks").EnumerateArray().Sum(w => w.GetProperty("requested").GetDecimal()));
    }

    [Fact]
    public async Task MaterialReceiptAndAttributionUseInventoryAndDonationUnitsRespectively()
    {
        using var citizen = await fixture.Login("citizen");
        using var manager = await fixture.Login("case");
        using var logistics = await fixture.Login("logistics");
        using var administrator = await fixture.Login("admin");
        var (crisis, organisation, region, _) = await Geography();
        var requestId = Id(await Post(citizen, "/api/v1/requests", Submission(crisis, region, "l")));
        await Approve(manager, requestId);
        var stock = Id(await Post(logistics, "/api/v1/resources", Inventory(organisation, "ml", 0)));
        const string path = "/api/v1/funding/LK";
        var campaign = Id(await Post(administrator, path + "/campaigns", new
        {
            organisationId = organisation, crisisId = crisis, name = "Synthetic water donations",
            purpose = "Synthetic clean water relief", budget = 10000,
        }));
        (await citizen.PutAsJsonAsync("/api/v1/funding/profile", new { displayName = "Synthetic water donor" })).EnsureSuccessStatusCode();
        var donation = Id(await Post(citizen, path + "/donations", new
        {
            operationId = Guid.NewGuid(), campaignId = campaign, kind = "Material", category = "FoodWater", unit = "l", amount = 15,
        }));
        var receipt = new { reference = "SYNTHETIC-MIXED-UNIT-DONATION", resourceId = stock };
        await Post(administrator, $"{path}/donations/{donation}/confirm", receipt);
        await Post(administrator, $"{path}/donations/{donation}/confirm", receipt);
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        Assert.Equal(15000m, await db.Set<Resource>().Where(r => r.Id == stock).Select(r => r.Stock).SingleAsync());
        var attribution = Id(await Post(administrator, $"{path}/donations/{donation}/allocations", new
        {
            operationId = Guid.NewGuid(), requestId, amount = 15,
        }));
        var shipment = Id(await Post(logistics, "/api/v1/allocations", new { requestId, resourceId = stock, quantity = 15000 }));
        await Deliver(logistics, shipment, 15000);
        var delivery = Id(await logistics.GetFromJsonAsync<JsonElement>($"/api/v1/allocations/{shipment}/receipt"));
        await Post(administrator, $"{path}/allocations/{attribution}/expenses", new
        {
            operationId = Guid.NewGuid(), amount = 15, reference = "SYNTHETIC-WATER-ATTRIBUTION", deliveryConfirmationId = delivery,
        });
        var workspace = await citizen.GetFromJsonAsync<JsonElement>(path + "/workspace");
        var report = Assert.Single(workspace.GetProperty("materialReports").EnumerateArray(), r => r.GetProperty("campaignId").GetGuid() == campaign);
        Assert.Equal("ml", report.GetProperty("unit").GetString());
        Assert.Equal(15000m, report.GetProperty("received").GetDecimal());
        Assert.Equal(15000m, report.GetProperty("distributed").GetDecimal());
    }

    private async Task<(Guid Crisis, Guid Organisation, Guid Local, Guid Foreign)> Geography()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var crisis = await db.Set<Crisis>().SingleAsync(c => c.Name == "Kelani River flood response");
        var local = await db.Set<AdministrativeDivision>().Where(d => d.CountryCode == "LK").Select(d => d.Id).FirstAsync();
        var foreign = await db.Set<AdministrativeDivision>().Where(d => d.CountryCode == "NP").Select(d => d.Id).FirstAsync();
        return (crisis.Id, crisis.PrimaryOrganisationId!.Value, local, foreign);
    }

    private static object Submission(Guid crisis, Guid region, string? unit) => new
    {
        crisisId = crisis, administrativeDivisionId = region, unit, quantity = 20, category = "FoodWater", priority = "High",
        description = "Synthetic household requires twenty litres of drinking water.", locationText = "Synthetic collection point",
        householdSize = 3, accessibilityNeeds = "", submissionKey = Guid.NewGuid().ToString(), synthetic = true,
    };

    private static object Inventory(Guid organisation, string unit, decimal stock) => new
    {
        organisationId = organisation, unit, stock, category = "FoodWater", name = "Synthetic drinking water stock",
        locationText = "Synthetic depot", latitude = 6.93, longitude = 79.89, suitability = "Sealed drinking water", transportAvailable = true,
    };

    private static Guid Id(JsonElement value) => value.GetProperty("id").GetGuid();

    private static async Task<JsonElement> Post(HttpClient client, string path, object body)
    {
        using var response = await client.PostAsJsonAsync(path, body);
        Assert.True(response.IsSuccessStatusCode, $"{path}: {await response.Content.ReadAsStringAsync()}");
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task Approve(HttpClient manager, Guid request)
    {
        foreach (var status in new[] { "UnderReview", "Verified", "Approved" })
            (await manager.PatchAsJsonAsync($"/api/v1/requests/{request}/status", new { status, reason = "Synthetic review." })).EnsureSuccessStatusCode();
    }

    private static async Task Deliver(HttpClient logistics, Guid shipment, decimal stockQuantity)
    {
        (await logistics.PostAsync($"/api/v1/allocations/{shipment}/Dispatch", null)).EnsureSuccessStatusCode();
        await Post(logistics, $"/api/v1/allocations/{shipment}/Deliver", new
        {
            reference = $"SYNTHETIC-WATER-{shipment:N}", confirmedQuantity = stockQuantity, receivedBy = "Synthetic receiving representative",
            method = "ReceivingStaff", receivedAt = DateTimeOffset.UtcNow,
        });
    }
}

public sealed class ResourceMeasurementMigrationTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task UpgradePreservesCasesStockAndHistoryWithoutInventingHistoricalUnits()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var requests = await db.Set<AssistanceRequest>().AsNoTracking().OrderBy(r => r.Id)
            .Select(r => new { r.Id, r.Reference, r.Quantity, r.DeliveredQuantity, r.CreatedAt, r.Status }).ToListAsync();
        var movements = await db.Set<RequestHistory>().Select(r => r.Id).OrderBy(id => id).ToListAsync();
        var stock = await db.Set<Resource>().OrderBy(r => r.Id).Select(r => new { r.Id, r.Unit, r.Stock }).ToListAsync();
        var migrator = db.GetService<IMigrator>();
        const string before = "20261118050949_FundingNotificationOutbox";
        const string current = "20261118062152_ResourceMeasurement";
        await migrator.MigrateAsync(before);
        var script = migrator.GenerateScript(before, current, MigrationsSqlGenerationOptions.Idempotent);
        var batches = Regex.Split(script, @"(?im)^GO[ \t]*\r?$").Where(batch => !string.IsNullOrWhiteSpace(batch)).ToList();
        // Use the same connection for all SQL batches, including the transaction across batches.
        await db.Database.OpenConnectionAsync();
        try
        {
            foreach (var batch in batches) await db.Database.ExecuteSqlRawAsync(batch);
            foreach (var batch in batches) await db.Database.ExecuteSqlRawAsync(batch);
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
        var upgraded = await db.Set<AssistanceRequest>().AsNoTracking().OrderBy(r => r.Id)
            .Select(r => new { r.Id, r.Reference, r.Quantity, r.DeliveredQuantity, r.CreatedAt, r.Status }).ToListAsync();
        Assert.Equal(requests, upgraded);
        Assert.Equal(movements, await db.Set<RequestHistory>().Select(r => r.Id).OrderBy(id => id).ToListAsync());
        Assert.Equal(stock, await db.Set<Resource>().OrderBy(r => r.Id).Select(r => new { r.Id, r.Unit, r.Stock }).ToListAsync());
        var preserved = await db.Set<AssistanceRequest>().AsNoTracking().ToListAsync();
        Assert.All(preserved.Where(r => r.Category != AidCategory.Shelter), r => Assert.True(r.UnitRequiresClarification));
        Assert.Equal("household", Assert.Single(preserved, r => r.Category == AidCategory.Shelter).Unit);
        Assert.All(preserved, r => Assert.Null(r.AdministrativeDivisionId));
    }
}
