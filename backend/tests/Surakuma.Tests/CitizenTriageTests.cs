using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class CitizenTriageTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task CitizenSupplyItemsAreValidatedAndSavedOnceWithOneRequest()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var seed = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(r => r.SubmissionKey == "seed-food");
        using var citizen = await fixture.Login("citizen");
        using var manager = await fixture.Login("case");
        CitizenSupplyItem[] items = [new("Blankets", 2, "pieces"), new("Water", 2.5m, "l"),
            new("DryRations", 3, "packs"), new("Hygiene", 1, "packs")];
        object Submission(CitizenSupplyItem[] supplies, string key) => new
        {
            seed.CrisisId, category = "FoodWater", description = "Synthetic test of multiple food and water items.",
            locationText = "Synthetic collection point", householdSize = 1, accessibilityNeeds = "", quantity = 1,
            submissionKey = key, synthetic = true, intake = new { timing = "WithinDay", supplyItems = supplies }
        };
        foreach (var invalid in new CitizenSupplyItem[][] {
            [.. items, new("BabyFormula", 1, "packs")],
            [items[0], items[0]],
            [items[0] with { Quantity = 1.5m }],
            [items[0] with { Unit = "vials" }],
            [new("NotInTheList", 1, "packs")] })
        {
            using var rejected = await citizen.PostAsJsonAsync("/api/v1/requests", Submission(invalid, Guid.NewGuid().ToString("N")));
            Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        }

        var key = Guid.NewGuid().ToString("N");
        using var first = await citizen.PostAsJsonAsync("/api/v1/requests", Submission(items, key));
        first.EnsureSuccessStatusCode();
        var id = (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        using var retry = await citizen.PostAsJsonAsync("/api/v1/requests", Submission(items, key));
        retry.EnsureSuccessStatusCode();
        Assert.Equal(id, (await retry.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid());
        var saved = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(r => r.Id == id);
        Assert.Equal("Water", saved.Intake!.Need);
        Assert.Equal(items, saved.Intake.SupplyItems);
        Assert.Equal(7.5m, saved.IntakeScore);
        Assert.Equal(4, await db.Set<CaseNeed>().CountAsync(item => item.RequestId == id));

        var plan = await manager.GetFromJsonAsync<JsonElement>($"/api/v1/fulfillment/cases/{id}?countryCode=LK");
        var water = Assert.Single(plan.GetProperty("items").EnumerateArray(), line => line.GetProperty("name").GetString() == "Drinking water");
        Assert.Equal(2.5m, water.GetProperty("requiredQuantity").GetDecimal());
        Assert.Equal("l", water.GetProperty("unit").GetString());
    }

    [Fact]
    public async Task SupplyIntakeIgnoresClientPriorityAgesOnceAndRecordsUnavailableAi()
    {
        var ct = CancellationToken.None;
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var seed = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(r => r.SubmissionKey == "seed-food", ct);
        using var citizen = await fixture.Login("citizen");
        var request = new CreateRequestInput(seed.CrisisId, null, AidCategory.FoodWater, Priority.Low,
            "Synthetic test: an infant is running out of formula.", "Demo collection point", null, null, 1, "", 1,
            Guid.NewGuid().ToString("N"), true, Unit: "packs", Intake: new("BabyFormula", "WithinDay", YoungOrPregnant: true,
                Destination: "Irrelevant transport answer"));
        var json = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web);
        json.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
        using var submitted = await citizen.PostAsJsonAsync("/api/v1/requests", request, json, ct);
        submitted.EnsureSuccessStatusCode();
        var id = (await submitted.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>(ct)).GetProperty("id").GetGuid();
        var saved = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(r => r.Id == id, ct);
        Assert.Equal(9.5m, saved.IntakeScore);
        Assert.Equal(Priority.High, saved.Priority);
        Assert.Null(saved.Intake!.Destination);
        Assert.Equal("Pending", saved.AssessmentState);

        var worker = new RequestAnalysisWorker(fixture.Factory.Services.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<RequestAnalysisWorker>.Instance);
        await worker.UpdatePriorityScores(saved.CreatedAt.AddHours(3), ct);
        await worker.UpdatePriorityScores(saved.CreatedAt.AddHours(3), ct);
        var aged = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(r => r.Id == id, ct);
        Assert.Equal(10.5m, aged.PriorityScore);
        Assert.Equal(Priority.Urgent, aged.Priority);

        Assert.True(await worker.ProcessNext(ct));
        var failed = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(r => r.Id == id, ct);
        Assert.Equal("Failed", failed.AssessmentState);
        Assert.Equal(Priority.Urgent, failed.Priority);
        Assert.False(await db.Set<Recommendation>().AnyAsync(r => r.RequestId == id, ct));
        await worker.UpdatePriorityScores(saved.CreatedAt.AddHours(6), ct);
        var agedAfterFailure = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(r => r.Id == id, ct);
        Assert.Equal(11.5m, agedAfterFailure.PriorityScore);
        Assert.Equal(Priority.Urgent, agedAfterFailure.Priority);
        using var staff = await fixture.Login("case");
        using var manual = await staff.PostAsync($"/api/v1/requests/{id}/recommendations/generate", null, ct);
        Assert.Equal(HttpStatusCode.BadRequest, manual.StatusCode);
    }

    [Theory]
    [InlineData("Yes", Priority.Critical, false)]
    [InlineData("No", Priority.High, false)]
    [InlineData("Yes", Priority.Critical, true)]
    [InlineData("No", Priority.High, true)]
    public async Task UnavailableAssessmentPreservesImmediateDangerAndRaisesLowerPriority(string danger, Priority expected, bool exhaustRetries)
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var seed = await db.Set<AssistanceRequest>().SingleAsync(r => r.SubmissionKey == "seed-food");
        using var citizen = await fixture.Login("citizen");
        var response = await citizen.PostAsJsonAsync("/api/v1/requests", new {
            crisisId = seed.CrisisId, category = "Medical", priority = "Low", description = "Synthetic refill request for the workflow rehearsal.",
            locationText = "Synthetic collection point", householdSize = 1, accessibilityNeeds = "", quantity = 1,
            submissionKey = Guid.NewGuid().ToString("N"), synthetic = true,
            intake = new { need = "MedicineRefill", timing = "Later", danger }
        });
        response.EnsureSuccessStatusCode();
        var id = (await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetGuid();
        using var failingHost = exhaustRetries ? fixture.Factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddScoped<RequestIntelligence>(_ => throw new InvalidOperationException("Synthetic worker failure.")))) : null;
        if (exhaustRetries)
            await db.Set<RequestAnalysisJob>().Where(j => j.RequestId == id).ExecuteUpdateAsync(set => set.SetProperty(j => j.Attempts, 2));
        var worker = new RequestAnalysisWorker((failingHost ?? fixture.Factory).Services.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<RequestAnalysisWorker>.Instance);
        Assert.True(await worker.ProcessNext(CancellationToken.None));
        var failed = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(r => r.Id == id);
        Assert.Equal("Failed", failed.AssessmentState);
        Assert.Equal(expected, failed.Priority);
        await worker.UpdatePriorityScores(failed.CreatedAt.AddHours(3), CancellationToken.None);
        Assert.Equal(expected, await db.Set<AssistanceRequest>().Where(r => r.Id == id).Select(r => r.Priority).SingleAsync());
    }

    [Theory]
    [InlineData(4.5, Priority.Low)]
    [InlineData(5, Priority.Medium)]
    [InlineData(7, Priority.High)]
    [InlineData(10, Priority.Urgent)]
    [InlineData(13, Priority.Critical)]
    public void PriorityThresholdsKeepHalfPoints(double points, Priority expected) =>
        Assert.Equal(expected, CitizenTriage.PriorityFor((decimal)points));

    [Fact]
    public async Task PriorityMigrationRestoresOpenFailedCasesAndRespectsReviewedAndClosedCases()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        try
        {
            var seed = await db.Set<AssistanceRequest>().SingleAsync(r => r.SubmissionKey == "seed-food");
            AssistanceRequest HistoricalCase(bool danger = false) => new() {
                CrisisId = seed.CrisisId, CitizenId = seed.CitizenId, OrganisationId = seed.OrganisationId,
                Category = AidCategory.Shelter, SubmissionKey = Guid.NewGuid().ToString("N"), Priority = Priority.High,
                IntakeJson = """{"SafeTonight":"No"}""", ImmediateDanger = danger, AssessmentState = "Failed"
            };
            var critical = HistoricalCase(true);
            var urgent = HistoricalCase();
            var reviewed = HistoricalCase();
            var closed = HistoricalCase();
            closed.Status = RequestStatus.Closed;
            db.AddRange(critical, urgent, reviewed, closed);
            var recommendation = new Recommendation { RequestId = reviewed.Id };
            db.Add(recommendation);
            db.Add(new HumanDecision { RecommendationId = recommendation.Id, RequestId = reviewed.Id,
                ActorId = seed.CitizenId, Action = "Modify", FinalPriority = Priority.High });
            await db.SaveChangesAsync();
            await db.Database.MigrateAsync("20261121120000_ActiveCitizenFeedback");
            await db.Database.MigrateAsync();
            foreach (var (request, expected) in new[] { (critical, Priority.Critical), (urgent, Priority.Urgent),
                (reviewed, Priority.High), (closed, Priority.High) })
                Assert.Equal(expected, await db.Set<AssistanceRequest>().Where(r => r.Id == request.Id).Select(r => r.Priority).SingleAsync());
        }
        finally
        {
            await db.Database.MigrateAsync();
        }
    }

    [Fact]
    public void ShelterAndMedicalCareUseServiceFacts()
    {
        var shelter = CitizenTriage.Validate(AidCategory.Shelter, new(SafeTonight: "No", TravelHelp: "No", StepFree: true));
        Assert.Equal(((decimal?)null, Priority.Urgent), CitizenTriage.AtIntake(AidCategory.Shelter, shelter, 3));
        var care = CitizenTriage.Validate(AidCategory.Medical, new("MedicalCare", "Now", Danger: "Yes"));
        Assert.Equal(((decimal?)null, Priority.Critical), CitizenTriage.AtIntake(AidCategory.Medical, care, 1));
    }
}
