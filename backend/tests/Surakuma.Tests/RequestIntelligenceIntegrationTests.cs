using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class RequestIntelligenceIntegrationTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task HistoricalAiRecordsUseNeutralLabelsOnWebsiteEndpoints()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var request = await db.Set<AssistanceRequest>().SingleAsync(r => r.SubmissionKey == "seed-food");
        var recommendation = new Recommendation { RequestId = request.Id, Provider = "Gemini", Model = "gemini-3.1-flash-lite",
            Explanation = "Gemini suggested reviewing the need.", SignalsJson = "[\"food\"]" };
        var briefing = new CrisisBriefing { CrisisId = request.CrisisId, Source = "Gemini · gemini-3.1-flash-lite",
            Draft = "Review need and available stock.", FactsJson = "{}", CreatedByUserId = request.CitizenId };
        var audit = new AuditEvent { Action = "AiGenerated", EntityType = nameof(Recommendation),
            EntityId = recommendation.Id, Detail = recommendation.Provider, CountryCode = "LK" };
        var retiredAlert = new AdminAlert { ConditionKey = "service:generativelanguage.googleapis.com:",
            Message = "Repeated provider failures: generativelanguage.googleapis.com", Link = "/admin?section=integrations" };
        db.AddRange(recommendation, briefing, audit, retiredAlert);
        await db.SaveChangesAsync();

        using var admin = await fixture.Login("admin");
        using var logistics = await fixture.Login("logistics");
        foreach (var (client, route) in new[]
        {
            (admin, $"/api/v1/requests/{request.Id}/recommendations"),
            (logistics, $"/api/v1/requests/{request.Id}/allocation-recommendations"),
            (admin, $"/api/v1/crises/{request.CrisisId}/decision-support?countryCode=LK"),
            (admin, "/api/v1/admin/audit?action=AiGenerated")
        })
        {
            var body = await client.GetStringAsync(route);
            Assert.Contains("Historical AI result", body);
            Assert.DoesNotContain("gemini", body, StringComparison.OrdinalIgnoreCase);
        }
        var alerts = await admin.GetStringAsync("/api/v1/admin/alerts");
        Assert.DoesNotContain(retiredAlert.Id.ToString(), alerts);
        Assert.Equal("Gemini", await db.Set<Recommendation>().Where(r => r.Id == recommendation.Id).Select(r => r.Provider).SingleAsync());
    }

    [Theory]
    [InlineData("LK", "si", "අපේ පවුලට බෙහෙත් අවශ්‍යයි. රෝගියාට හුස්ම ගන්න බැහැ.", "කරුණාකර ඔබගේ ඉල්ලීම බලන්න.", 6.93, 79.89)]
    [InlineData("IN", "hi", "बाढ़ के बाद दवा चाहिए। मरीज सांस नहीं ले पा रहा है।", "कृपया अपना अनुरोध देखें।", 26.18, 91.75)]
    [InlineData("NP", "ne", "बाढीपछि औषधि चाहिन्छ। बिरामी सास फेर्न सक्दैन।", "कृपया आफ्नो अनुरोध हेर्नुहोस्।", 27.70, 85.32)]
    public async Task DurableLocalizedIntelligenceUsesVerifiedScopeAndPreservesReview(string country, string language,
        string description, string copy, double latitude, double longitude)
    {
        var ct = CancellationToken.None;
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var citizenId = await db.Users.Where(u => u.Email == "citizen@surakuma.test").Select(u => u.Id).SingleAsync(ct);
        var coordinatorId = await db.Users.Where(u => u.Email == "coordinator@surakuma.test").Select(u => u.Id).SingleAsync(ct);
        var organisation = new Organisation { Name = $"Synthetic intelligence response partner {country}" };
        var crisis = new Crisis { Name = $"Synthetic response intelligence {country}", CountryCode = country,
            Type = "Flood", District = "Synthetic demonstration precinct", Latitude = latitude, Longitude = longitude,
            PrimaryOrganisationId = organisation.Id };
        db.AddRange(organisation, crisis,
            new OrganisationCountry { OrganisationId = organisation.Id, CountryCode = country, VerificationState = "Verified" },
            new Membership { UserId = coordinatorId, Role = Roles.Coordinator, OrganisationId = organisation.Id,
                CountryCode = country, CrisisId = crisis.Id },
            new CrisisAssignment { CrisisId = crisis.Id, UserId = coordinatorId });
        await db.SaveChangesAsync(ct);

        using var host = fixture.Factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Ai:OpenAiApiKey"] = "test-transport-only",
                ["Ai:ApprovedSyntheticAccountIds:0"] = citizenId,
                ["Ai:OperationalBriefingsEnabled"] = "true"
            }));
            builder.ConfigureServices(services =>
            {
                foreach (var task in AiProvider.Tasks)
                    services.AddHttpClient("surakuma-ai-OpenAI-" + task).ConfigurePrimaryHttpMessageHandler(() => new IntelligenceTransport(copy));
            });
        });
        using var citizen = await fixture.Login("citizen");
        using var admin = await fixture.Login("admin");
        using var caller = host.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });
        caller.DefaultRequestHeaders.Authorization = admin.DefaultRequestHeaders.Authorization;

        var submission = new
        {
            crisisId = crisis.Id, category = "Other", priority = "Normal", description,
            locationText = "Synthetic flood distribution point", latitude, longitude, householdSize = 3,
            accessibilityNeeds = "", quantity = 2, unit = "pieces", submissionKey = Guid.NewGuid().ToString("N"), synthetic = true
        };
        var first = await PostJson(citizen, "/api/v1/requests", submission);
        var replay = await PostJson(citizen, "/api/v1/requests", submission);
        var id = first.GetProperty("id").GetGuid();
        Assert.Equal(id, replay.GetProperty("id").GetGuid());
        var second = await PostJson(citizen, "/api/v1/requests",
            submission with { submissionKey = Guid.NewGuid().ToString("N"), description = "Synthetic incident: prescription supply depleted." });
        var secondId = second.GetProperty("id").GetGuid();

        var path = $"/api/v1/requests/{id}";
        var queued = await caller.GetFromJsonAsync<JsonElement>(path + "/recommendations?countryCode=" + country, ct);
        Assert.Equal("Queued", queued.GetProperty("processing").GetProperty("state").GetString());
        Assert.Empty(queued.GetProperty("recommendations").EnumerateArray());
        // An expired lease is reclaimed on restart. Keeping these jobs first isolates the scenario from other fixture cases.
        var firstInQueue = DateTimeOffset.UtcNow.AddDays(-8);
        await db.Set<RequestAnalysisJob>().Where(j => j.RequestId == id).ExecuteUpdateAsync(set => set
            .SetProperty(j => j.State, "Processing").SetProperty(j => j.Lease, Guid.NewGuid())
            .SetProperty(j => j.AvailableAt, firstInQueue).SetProperty(j => j.Attempts, 1), ct);
        await db.Set<RequestAnalysisJob>().Where(j => j.RequestId == secondId)
            .ExecuteUpdateAsync(set => set.SetProperty(j => j.AvailableAt, firstInQueue.AddHours(1)), ct);
        var worker = new RequestAnalysisWorker(host.Services.GetRequiredService<IServiceScopeFactory>(), NullLogger<RequestAnalysisWorker>.Instance);
        Assert.True(await worker.ProcessNext(ct));
        Assert.True(await worker.ProcessNext(ct));

        var analysis = await caller.GetFromJsonAsync<JsonElement>(path + "/recommendations?countryCode=" + country, ct);
        Assert.Equal("Completed", analysis.GetProperty("processing").GetProperty("state").GetString());
        Assert.Equal(2, analysis.GetProperty("processing").GetProperty("attempts").GetInt32());
        var recommendation = Assert.Single(analysis.GetProperty("recommendations").EnumerateArray());
        Assert.Equal("OpenAI", recommendation.GetProperty("provider").GetString());
        Assert.Equal("Medical", recommendation.GetProperty("category").GetString());
        Assert.Equal(100, recommendation.GetProperty("urgencyScore").GetInt32());
        Assert.Equal("Pending", recommendation.GetProperty("reviewState").GetString());
        var duplicate = Assert.Single(analysis.GetProperty("duplicates").EnumerateArray());
        Assert.Equal(secondId, duplicate.GetProperty("candidateId").GetGuid());
        Assert.Equal("text-embedding-3-small", duplicate.GetProperty("model").GetString());
        Assert.Equal("Pending", duplicate.GetProperty("state").GetString());
        var wrongCountry = country == "LK" ? "NP" : "LK";
        using var denied = await caller.GetAsync(path + "/recommendations?countryCode=" + wrongCountry, ct);
        Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);
        var stored = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(r => r.Id == id, ct);
        Assert.Equal(AidCategory.Other, stored.Category);
        Assert.Equal(RequestStatus.Submitted, stored.Status);

        var review = await PostJson(caller, path + "/decisions?countryCode=" + country,
            new { recommendationId = recommendation.GetProperty("id").GetGuid(), action = "Approve", reason = "Synthetic review completed." });
        Assert.Equal("Approve", review.GetProperty("reviewState").GetString());
        Assert.Equal(Priority.Critical, await db.Set<AssistanceRequest>().Where(r => r.Id == id).Select(r => r.Priority).SingleAsync(ct));
        var outputs = await db.Set<AiInvocation>().AsNoTracking().Where(a => a.Task == "triage" && a.State == "Completed").ToListAsync(ct);
        Assert.Contains(outputs, a => a.Provider == "OpenAI" && a.Model == "gpt-6-luna" && a.InputTokens == 120 && a.EstimatedUsd > 0);
        Assert.Single(await db.Set<RequestAnalysisJob>().Where(j => j.RequestId == id).ToListAsync(ct));

        var message = await PostJson(caller, path + "/communications?countryCode=" + country, new { audience = "Citizen", language });
        Assert.Contains(copy, message.GetProperty("preview").GetString());
        Assert.Contains(stored.Reference, message.GetProperty("preview").GetString());
        var draftId = message.GetProperty("draft").GetProperty("id").GetGuid();
        var publishPath = path + $"/communications/{draftId}/publish?countryCode={country}";
        using var unreviewed = await caller.PostAsJsonAsync(publishPath, new { wordingReviewed = false }, ct);
        Assert.Equal(HttpStatusCode.BadRequest, unreviewed.StatusCode);
        await PostJson(caller, publishPath, new { wordingReviewed = true });
        await PostJson(caller, publishPath, new { wordingReviewed = true });
        var outbox = Assert.Single(await db.Set<OutboxMessage>().Where(o => o.Id == draftId).ToListAsync(ct));
        var email = CitizenEmailUpdate.FromOutbox(outbox, language);
        Assert.Equal(copy, email.ReviewedCopy);
        Assert.Equal(stored.Reference, email.Reference);
        Assert.Equal(RequestStatus.Submitted, email.Status);

        var staffMessage = await PostJson(caller, path + "/communications?countryCode=" + country, new { audience = "Staff", language });
        var staffDraftId = staffMessage.GetProperty("draft").GetProperty("id").GetGuid();
        await PostJson(caller, path + $"/communications/{staffDraftId}/publish?countryCode={country}", new { wordingReviewed = true });
        Assert.True(await db.Set<Notification>().AnyAsync(n => n.IsInternal && n.EventId == staffDraftId, ct));
        Assert.False(await db.Set<OutboxMessage>().AnyAsync(n => n.Id == staffDraftId, ct));

        if (country == "LK")
        {
            var decision = $"/api/v1/crises/{crisis.Id}/decision-support";
            var sparse = await PostJson(caller, decision + "/forecasts?countryCode=LK", new { category = "Transportation" });
            Assert.Equal(JsonValueKind.Null, sparse.GetProperty("record").GetProperty("estimate").ValueKind);
            for (int week = 1; week <= 8; week++)
                db.Add(new AssistanceRequest { CitizenId = citizenId, CrisisId = crisis.Id, Category = AidCategory.Transportation,
                    CreatedAt = DateTimeOffset.UtcNow.AddDays(-7 * week), Quantity = 5, Unit = "pieces",
                    SubmissionKey = Guid.NewGuid().ToString("N"), Synthetic = true });
            await db.SaveChangesAsync(ct);
            var validated = await PostJson(caller, decision + "/forecasts?countryCode=LK", new { category = "Transportation" });
            Assert.Equal(1, validated.GetProperty("record").GetProperty("estimate").GetDecimal());
            var evidence = validated.GetProperty("evidence");
            Assert.Equal(5, evidence.GetProperty("projection").GetProperty("validationPeriods").GetInt32());
            Assert.Contains("OpenAI", evidence.GetProperty("interpretation").GetProperty("source").GetString());
            var briefing = await PostJson(caller, decision + "/briefings?countryCode=LK", new { days = 7 });
            var briefingRecord = briefing.GetProperty("record");
            Assert.Contains("OpenAI", briefingRecord.GetProperty("source").GetString());
            using var selfReview = await caller.PostAsJsonAsync(decision + $"/briefings/{briefingRecord.GetProperty("id").GetGuid()}/review?countryCode=LK",
                new { reason = "Same author attempt" }, ct);
            Assert.Equal(HttpStatusCode.Forbidden, selfReview.StatusCode);
        }

        async Task<JsonElement> PostJson(HttpClient client, string route, object input)
        {
            using var response = await client.PostAsJsonAsync(route, input, ct);
            var body = await response.Content.ReadAsStringAsync(ct);
            Assert.True(response.IsSuccessStatusCode, $"{route}: {response.StatusCode} {body}");
            return JsonDocument.Parse(body).RootElement.Clone();
        }
    }

    private sealed class IntelligenceTransport(string copy) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));
            if (request.RequestUri!.AbsolutePath == "/v1/embeddings")
                return Response(new { data = new[] { new { embedding = Enumerable.Repeat(0.25f, 256) } }, usage = new { prompt_tokens = 7 } });
            var format = body.RootElement.GetProperty("text").GetProperty("format").GetProperty("name").GetString();
            var triage = new { category = "Medical", signals = new[] { "medicine", "immediate danger" } };
            var output = format == "triage" ? JsonSerializer.Serialize(triage) : JsonSerializer.Serialize(new { text = copy });
            return Response(new { status = "completed", output = new[] { new { type = "message",
                content = new[] { new { type = "output_text", text = output } } } }, usage = new { input_tokens = 120, output_tokens = 24 } });
        }

        private static HttpResponseMessage Response(object body) => new(HttpStatusCode.OK) { Content = JsonContent.Create(body) };
    }
}
