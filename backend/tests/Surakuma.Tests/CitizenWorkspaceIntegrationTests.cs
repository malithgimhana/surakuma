using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed partial class IntegrationTests
{
    [Fact]
    public async Task CitizenSubmissionAndDeliveryFeedbackAreIdempotentAndKeepStaffFollowUp()
    {
        using var citizen = await fixture.Login("citizen");
        using var manager = await fixture.Login("case");
        using var coordinator = await fixture.Login("coordinator");
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var crisis = await db.Set<Crisis>().SingleAsync(c => c.Name == "Kelani River flood response");
        var submission = new
        {
            CrisisId = crisis.Id, Category = "FoodWater", Priority = "Normal", Description = "Test delivery feedback concurrency",
            LocationText = "Synthetic Colombo community centre", HouseholdSize = 2, AccessibilityNeeds = "", Quantity = 2,
            Unit = "packs", SubmissionKey = Guid.NewGuid().ToString("N"), Synthetic = true
        };
        var submissions = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => citizen.PostAsJsonAsync("/api/v1/requests", submission)));
        var requestIds = await Task.WhenAll(submissions.Select(async response =>
        {
            using (response)
            {
                response.EnsureSuccessStatusCode();
                return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
            }
        }));
        var id = Assert.Single(requestIds.Distinct());
        var path = $"/api/v1/requests/{id}";
        var report = new FeedbackInput(2, true, true, "Test delivery problem");
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.PostAsJsonAsync($"{path}/feedback", report)).StatusCode);

        var delivered = await db.Set<AssistanceRequest>().SingleAsync(r => r.Id == id);
        delivered.Status = RequestStatus.Closed;
        delivered.DeliveredQuantity = 2;
        await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.PostAsJsonAsync($"{path}/feedback", report)).StatusCode);
        var results = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => citizen.PostAsJsonAsync($"{path}/feedback", report)));
        var feedbackIds = await Task.WhenAll(results.Select(async response =>
        {
            using (response)
            {
                response.EnsureSuccessStatusCode();
                return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
            }
        }));
        var feedbackId = Assert.Single(feedbackIds.Distinct());
        Assert.Equal(1, await db.Set<Feedback>().CountAsync(f => f.RequestId == id && !f.IsSuperseded));
        Assert.Equal(1, await db.Set<AuditEvent>().CountAsync(a => a.EntityId == id && a.Action == "FeedbackRecorded"));

        var tracked = await citizen.GetFromJsonAsync<JsonElement>(path);
        var feedback = Assert.Single(tracked.GetProperty("feedback").EnumerateArray());
        Assert.Equal(feedbackId, feedback.GetProperty("id").GetGuid());
        Assert.True(feedback.GetProperty("problem").GetBoolean());
        var followUps = await coordinator.GetFromJsonAsync<JsonElement>("/api/v1/requests?view=follow-ups");
        Assert.Contains(followUps.GetProperty("items").EnumerateArray(), r => r.GetProperty("id").GetGuid() == id);
        (await coordinator.PostAsJsonAsync($"{path}/escalation/resolve", new { note = "Synthetic issue resolved after contacting the household." })).EnsureSuccessStatusCode();
        (await citizen.PostAsJsonAsync($"{path}/feedback", report)).EnsureSuccessStatusCode();
        var resolved = await citizen.GetFromJsonAsync<JsonElement>(path);
        Assert.False(resolved.GetProperty("request").GetProperty("escalated").GetBoolean());
        Assert.Equal(1, await db.Set<AuditEvent>().CountAsync(a => a.EntityId == id && a.Action == "FeedbackRecorded"));
    }

    [Fact]
    public async Task CitizenStatusFiltersAndSummaryUseExactLifecycleStatesAndCountry()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var seed = await db.Set<AssistanceRequest>().SingleAsync(r => r.SubmissionKey == "seed-food");
        var search = $"Synthetic lifecycle fixture {Guid.NewGuid():N}";
        foreach (var state in Enum.GetValues<RequestStatus>())
            db.Add(new AssistanceRequest { CitizenId = seed.CitizenId, CrisisId = seed.CrisisId, Category = AidCategory.FoodWater,
                Status = state, Quantity = 1, Unit = "packs", Description = search, SubmissionKey = $"{search}-{state}", Synthetic = true });
        await db.SaveChangesAsync();

        using var citizen = await fixture.Login("citizen");
        foreach (var state in Enum.GetValues<RequestStatus>())
        {
            var filtered = await citizen.GetFromJsonAsync<JsonElement>($"/api/v1/requests/mine?countryCode=LK&status={state}&search={Uri.EscapeDataString(search)}");
            Assert.Equal(state.ToString(), Assert.Single(filtered.GetProperty("items").EnumerateArray()).GetProperty("status").GetString());
        }
        var summary = await citizen.GetFromJsonAsync<JsonElement>("/api/v1/requests/mine/summary?countryCode=LK");
        Assert.All(Enum.GetValues<RequestStatus>(), state => Assert.Contains(summary.EnumerateArray(),
            row => row.GetProperty("status").GetString() == state.ToString() && row.GetProperty("count").GetInt32() > 0));
        var other = await citizen.GetFromJsonAsync<JsonElement>($"/api/v1/requests/mine?countryCode=IN&search={Uri.EscapeDataString(search)}");
        Assert.Empty(other.GetProperty("items").EnumerateArray());
        using var manager = await fixture.Login("case");
        Assert.Equal(HttpStatusCode.Forbidden, (await manager.GetAsync("/api/v1/requests/mine/summary?countryCode=LK")).StatusCode);
    }
}
