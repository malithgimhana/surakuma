using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed partial class IntegrationTests
{
    [Fact]
    public async Task InvalidCoordinatesAreRejectedBeforeCreatingPublicShelter()
    {
        using var client = await fixture.Login("shelter");
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        Guid organisationId = await db.Set<Membership>().Where(x => x.Role == Roles.ShelterAdmin).Select(x => x.OrganisationId).FirstAsync();
        var result = await client.PostAsJsonAsync("/api/v1/shelters", new
        {
            organisationId,
            name = "Invalid coordinate test",
            address = "Demo location",
            latitude = 999,
            longitude = 79.8,
            capacity = 10,
            accessible = true,
            open = true,
            facilities = "Demo"
        });
        Assert.Equal(HttpStatusCode.BadRequest, result.StatusCode);
        Assert.False(await db.Set<Shelter>().AnyAsync(x => x.Name == "Invalid coordinate test"));
    }
    [Fact]
    public async Task OrganisationSharingRequiresExplicitCoordinatorAction()
    {
        string account = "partner" + Guid.NewGuid().ToString("N")[..8];
        Guid requestId, partnerId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var request = await db.Set<AssistanceRequest>().FirstAsync();
            requestId = request.Id;
            partnerId = await db.Set<Organisation>().Where(o => o.Id != request.OrganisationId).Select(o => o.Id).FirstAsync();
            var user = new AppUser { UserName = account + "@surakuma.test", Email = account + "@surakuma.test", DisplayName = "Synthetic partner officer" };
            Assert.True((await users.CreateAsync(user, fixture.Password)).Succeeded);
            await users.AddToRoleAsync(user, Roles.CaseManager);
            db.Add(new Membership { UserId = user.Id, OrganisationId = partnerId, Role = Roles.CaseManager });
            await db.SaveChangesAsync();
        }
        using var partner = await fixture.Login(account);
        Assert.Equal(HttpStatusCode.NotFound, (await partner.GetAsync($"/api/v1/requests/{requestId}")).StatusCode);
        using var coordinator = await fixture.Login("coordinator");
        (await coordinator.PostAsJsonAsync($"/api/v1/requests/{requestId}/shares", new
        {
            organisationId = partnerId
        })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await partner.GetAsync($"/api/v1/requests/{requestId}")).StatusCode);
    }
    [Fact]
    public async Task ConcurrentShelterReservationsCannotOverbookAndCheckInIsSeparate()
    {
        Guid firstId, secondId, shelterId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var seed = await db.Set<AssistanceRequest>().FirstAsync();
            var shelter = new Shelter { OrganisationId = seed.OrganisationId, Name = "Concurrency test shelter", Capacity = 5, Accessible = true };
            db.Add(shelter);
            shelterId = shelter.Id;
            var first = new AssistanceRequest { CitizenId = seed.CitizenId, CrisisId = seed.CrisisId, OrganisationId = seed.OrganisationId, Category = AidCategory.Shelter, HouseholdSize = 4, Quantity = 1, Status = RequestStatus.Approved, SubmissionKey = Guid.NewGuid().ToString() };
            var second = new AssistanceRequest { CitizenId = seed.CitizenId, CrisisId = seed.CrisisId, OrganisationId = seed.OrganisationId, Category = AidCategory.Shelter, HouseholdSize = 4, Quantity = 1, Status = RequestStatus.Approved, SubmissionKey = Guid.NewGuid().ToString() };
            db.AddRange(first, second);
            await db.SaveChangesAsync();
            firstId = first.Id;
            secondId = second.Id;
        }
        using var a = await fixture.Login("shelter");
        using var b = await fixture.Login("shelter");
        var results = await Task.WhenAll(a.PostAsJsonAsync("/api/v1/shelter-allocations", new
        {
            requestId = firstId,
            shelterId
        }), b.PostAsJsonAsync("/api/v1/shelter-allocations", new
        {
            requestId = secondId,
            shelterId
        }));
        var winner = Assert.Single(results, r => r.IsSuccessStatusCode);
        Assert.All(results.Where(r => !r.IsSuccessStatusCode), r => Assert.Contains(r.StatusCode, new[] { HttpStatusCode.BadRequest, HttpStatusCode.Conflict }));
        Guid placementId = (await winner.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var shelter = await scope.ServiceProvider.GetRequiredService<CrisisDbContext>().Set<Shelter>().FindAsync(shelterId);
            Assert.Equal(4, shelter!.Reserved);
            Assert.Equal(0, shelter.Occupancy);
        }
        (await a.PostAsync($"/api/v1/shelter-allocations/{placementId}/CheckIn", null)).EnsureSuccessStatusCode();
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var shelter = await scope.ServiceProvider.GetRequiredService<CrisisDbContext>().Set<Shelter>().FindAsync(shelterId);
            Assert.Equal(0, shelter!.Reserved);
            Assert.Equal(4, shelter.Occupancy);
        }
        (await a.PostAsync($"/api/v1/shelter-allocations/{placementId}/Depart", null)).EnsureSuccessStatusCode();
    }
    [Fact]
    public async Task PartialDeliveryRemainderAndClosureWorkEndToEnd()
    {
        Guid requestId, resourceId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var seed = await db.Set<AssistanceRequest>().FirstAsync();
            string citizenId = await db.Users.Where(x => x.UserName == "citizen@surakuma.test").Select(x => x.Id).SingleAsync();
            var request = new AssistanceRequest { CitizenId = citizenId, CrisisId = seed.CrisisId, OrganisationId = seed.OrganisationId, Category = AidCategory.FoodWater, Quantity = 10, Status = RequestStatus.Approved, SubmissionKey = Guid.NewGuid().ToString() };
            var resource = new Resource { OrganisationId = seed.OrganisationId, Name = "Delivery test packs", Category = AidCategory.FoodWater, Stock = 6 };
            db.AddRange(request, resource);
            await db.SaveChangesAsync();
            requestId = request.Id;
            resourceId = resource.Id;
        }
        using var logistics = await fixture.Login("logistics");
        async Task Deliver(int quantity)
        {
            var response = await logistics.PostAsJsonAsync("/api/v1/allocations", new
            {
                requestId,
                resourceId,
                quantity
            });
            response.EnsureSuccessStatusCode();
            Guid id = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
            (await logistics.PostAsync($"/api/v1/allocations/{id}/Dispatch", null)).EnsureSuccessStatusCode();
            (await logistics.PostAsync($"/api/v1/allocations/{id}/Deliver", null)).EnsureSuccessStatusCode();
        }
        await Deliver(6);
        var partial = await logistics.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{requestId}");
        Assert.Equal("PartiallyFulfilled", partial.GetProperty("request").GetProperty("status").GetString());
        (await logistics.PostAsJsonAsync($"/api/v1/resources/{resourceId}/replenish", new
        {
            quantity = 4,
            note = "Synthetic replenishment"
        })).EnsureSuccessStatusCode();
        await Deliver(4);
        using var manager = await fixture.Login("case");
        (await manager.PatchAsJsonAsync($"/api/v1/requests/{requestId}/status", new
        {
            status = "Closed",
            reason = "Delivery verified by staff."
        })).EnsureSuccessStatusCode();
        var completed = await logistics.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{requestId}");
        Assert.Equal(10, completed.GetProperty("request").GetProperty("deliveredQuantity").GetDecimal());
        Assert.Equal("Closed", completed.GetProperty("request").GetProperty("status").GetString());
        using var citizen = await fixture.Login("citizen");
        (await citizen.PostAsJsonAsync($"/api/v1/requests/{requestId}/feedback", new
        {
            rating = 4,
            received = true,
            problem = true,
            comment = "Synthetic delivery issue for staff review."
        })).EnsureSuccessStatusCode();
        var reviewed = await manager.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{requestId}");
        Assert.True(reviewed.GetProperty("request").GetProperty("escalated").GetBoolean());
        Assert.Contains(reviewed.GetProperty("feedback").EnumerateArray(), x => x.GetProperty("comment").GetString() == "Synthetic delivery issue for staff review.");
    }
    [Fact]
    public async Task ReprocessingCapturedEventDoesNotCreateDuplicateNotificationOrDelivery()
    {
        Guid eventId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var r = await db.Set<AssistanceRequest>().FirstAsync();
            var message = new OutboxMessage { UserId = r.CitizenId, RequestId = r.Id, Message = "Synthetic test update", SinhalaMessage = "ආදර්ශ දැනුම්දීම", TamilMessage = "மாதிரி அறிவிப்பு" };
            db.Add(message);
            await db.SaveChangesAsync();
            eventId = message.Id;
        }
        var worker = new NotificationWorker(fixture.Factory.Services.GetRequiredService<IServiceScopeFactory>(), NullLogger<NotificationWorker>.Instance);
        for (int i = 0; i < 30; i++)
            await worker.ProcessOne(default);
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var message = await db.Set<OutboxMessage>().FindAsync(eventId);
            Assert.Equal("Captured", message!.State);
            message.State = "Pending";
            message.NextAttemptAt = DateTimeOffset.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        }
        await worker.ProcessOne(default);
        using var check = fixture.Factory.Services.CreateScope();
        var database = check.ServiceProvider.GetRequiredService<CrisisDbContext>();
        Assert.Equal(1, await database.Set<Notification>().CountAsync(x => x.EventId == eventId));
        Assert.Equal(1, await database.Set<NotificationDelivery>().CountAsync(x => x.EventId == eventId));
    }
    [Fact]
    public async Task RefreshTokenRotationRejectsReplayAndRevokesTokenFamily()
    {
        using var client = fixture.Factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), HandleCookies = false });
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new
        {
            email = "citizen@surakuma.test",
            password = fixture.Password
        });
        login.EnsureSuccessStatusCode();
        string originalCookie = login.Headers.GetValues("Set-Cookie").First().Split(';')[0];
        client.DefaultRequestHeaders.Add("Cookie", originalCookie);
        var first = await client.PostAsync("/api/v1/auth/refresh", null);
        first.EnsureSuccessStatusCode();
        string rotatedCookie = first.Headers.GetValues("Set-Cookie").First().Split(';')[0];
        Assert.NotEqual(originalCookie, rotatedCookie);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/v1/auth/refresh", null)).StatusCode);
        client.DefaultRequestHeaders.Remove("Cookie");
        client.DefaultRequestHeaders.Add("Cookie", rotatedCookie);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/v1/auth/refresh", null)).StatusCode);
    }
}
