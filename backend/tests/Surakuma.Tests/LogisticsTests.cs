using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class LogisticsTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task TransferCreditsCompatibleStockExactlyAndRejectsUnrepresentableAmounts()
    {
        using var logistics = await fixture.Login("logistics");
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var organisation = await db.Set<AssistanceRequest>().Where(r => r.SubmissionKey == "seed-food").Select(r => r.OrganisationId).SingleAsync();
        const string path = "/api/v1/logistics";
        async Task<Guid> Register(string unit, decimal stock)
        {
            var depot = Guid.NewGuid();
            (await logistics.PostAsJsonAsync(path + "/depots", new
            {
                operationId = depot, organisationId = organisation, countryCode = "LK", name = $"Synthetic {unit} depot", location = "Colombo",
            })).EnsureSuccessStatusCode();
            var item = Guid.NewGuid();
            (await logistics.PostAsJsonAsync("/api/v1/resources", new
            {
                operationId = item, organisationId = organisation, countryCode = "LK", depotId = depot,
                name = "Synthetic packaged water", category = "FoodWater", unit, stock, locationText = "Colombo",
                latitude = 6.92, longitude = 79.9, suitability = "", transportAvailable = true,
            })).EnsureSuccessStatusCode();
            return item;
        }
        var source = await Register("ml", 1501);
        var receiver = await Register("l", 0);
        var order = new
        {
            operationId = Guid.NewGuid(), kind = "Transfer", resourceId = source, destinationResourceId = receiver,
            quantity = 1501, reason = "Synthetic transfer between authorised depots.",
        };
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync(path + "/orders", order)).StatusCode);
        (await logistics.PostAsJsonAsync(path + "/orders", order with { quantity = 1500 })).EnsureSuccessStatusCode();
        var shipment = $"{path}/orders/{order.operationId}";
        (await logistics.PostAsJsonAsync($"/api/v1/fulfillment/orders/{order.operationId}/prepare", new { packedQuantity = 1500, note = "Packed for transfer." })).EnsureSuccessStatusCode();
        (await logistics.PostAsJsonAsync(shipment + "/dispatch", new { reason = "Synthetic dispatch." })).EnsureSuccessStatusCode();
        var delivery = new
        {
            reference = "SYNTHETIC-UNIT-TRANSFER", confirmedQuantity = 1500, receivedBy = "Synthetic depot",
            method = "ReceivingStaff", exceptionDetail = "Synthetic partial receipt.",
        };
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync(shipment + "/deliver",
            new { delivery = delivery with { confirmedQuantity = 1 } })).StatusCode);
        (await logistics.PostAsJsonAsync(shipment + "/deliver", new { delivery })).EnsureSuccessStatusCode();
        Assert.Equal(1m, await db.Set<Resource>().Where(r => r.Id == source).Select(r => r.Stock).SingleAsync());
        Assert.Equal(1.5m, await db.Set<Resource>().Where(r => r.Id == receiver).Select(r => r.Stock).SingleAsync());
        Assert.Equal(1.5m, await db.Set<StockMovement>().Where(m => m.ResourceId == receiver && m.Kind == "TransferReceived")
            .Select(m => m.Quantity).SingleAsync());
    }

    [Fact]
    public async Task ReceiveReserveDispatchAndTransferStockWithCountryScopedHistory()
    {
        using var admin = await fixture.Login("admin");
        const string module = "/api/v1/logistics";
        Guid organisationId, crisisId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            organisationId = await db.Set<OrganisationCountry>().Where(o => o.CountryCode == "LK" && o.VerificationState == "LegacyActive")
                .Select(o => o.OrganisationId).FirstAsync();
            crisisId = await db.Set<Crisis>().Where(c => c.CountryCode == "LK" && c.Active).Select(c => c.Id).FirstAsync();
            var registration = await db.Set<OrganisationCountry>().SingleOrDefaultAsync(o =>
                o.OrganisationId == organisationId && o.CountryCode == "NP");
            if (registration == null)
            {
                registration = new OrganisationCountry { OrganisationId = organisationId, CountryCode = "NP" };
                db.Add(registration);
            }
            registration.VerificationState = "Verified";
            await db.SaveChangesAsync();
        }
        async Task<Guid> Depot(string countryCode, string name)
        {
            var operationId = Guid.NewGuid();
            (await admin.PostAsJsonAsync($"{module}/depots", new { operationId, countryCode, organisationId, name, location = name })).EnsureSuccessStatusCode();
            return operationId;
        }
        async Task<Guid> Resource(string countryCode, Guid depotId)
        {
            var operationId = Guid.NewGuid();
            var registration = new { operationId, countryCode, organisationId, depotId, name = "Emergency family packs",
                code = "FAMILY-PACK", unit = "packs", category = "FoodWater", stock = 0, lowStockThreshold = 350,
                locationText = "Registered depot", latitude = countryCode == "NP" ? 27.7 : 6.92, longitude = countryCode == "NP" ? 85.3 : 79.9, suitability = "", transportAvailable = true };
            (await admin.PostAsJsonAsync("/api/v1/resources", registration)).EnsureSuccessStatusCode();
            (await admin.PostAsJsonAsync("/api/v1/resources", registration)).EnsureSuccessStatusCode();
            return operationId;
        }
        var origin = await Resource("LK", await Depot("LK", "Colombo logistics depot"));
        var receiver = await Resource("NP", await Depot("NP", "Kathmandu logistics depot"));
        async Task<JsonElement> Dashboard(HttpClient client) => await client.GetFromJsonAsync<JsonElement>(module);
        async Task CheckBalance(Guid id, decimal physical, decimal reserved, decimal available)
        {
            var dashboard = await Dashboard(admin);
            var item = Assert.Single(dashboard.GetProperty("inventory").EnumerateArray(), row => row.GetProperty("id").GetGuid() == id);
            Assert.Equal(physical, item.GetProperty("stock").GetDecimal());
            Assert.Equal(reserved, item.GetProperty("reserved").GetDecimal());
            Assert.Equal(available, item.GetProperty("available").GetDecimal());
        }

        var receipt = new { operationId = Guid.NewGuid(), delta = 500, reason = "Warehouse delivery received" };
        (await admin.PostAsJsonAsync($"{module}/resources/{origin}/stock", receipt)).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync($"{module}/resources/{origin}/stock", receipt)).EnsureSuccessStatusCode();

        var reservation = new { operationId = Guid.NewGuid(), kind = "Dispatch", resourceId = origin, crisisId,
            quantity = 200, reason = "Allocate family supplies to the crisis" };
        (await admin.PostAsJsonAsync($"{module}/orders", reservation)).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync($"{module}/orders", reservation)).EnsureSuccessStatusCode();
        await CheckBalance(origin, 500, 200, 300);
        var excess = new { operationId = Guid.NewGuid(), kind = "Dispatch", resourceId = origin, crisisId, quantity = 301, reason = "Exceeds available stock" };
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"{module}/orders", excess)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"{module}/resources/{origin}/stock",
            new { operationId = Guid.NewGuid(), delta = -301, reason = "Cannot adjust below reservations" })).StatusCode);
        var orderId = reservation.operationId;
        (await admin.PostAsJsonAsync($"/api/v1/fulfillment/orders/{orderId}/prepare", new { packedQuantity = 200, note = "Packed." })).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync($"{module}/orders/{orderId}/dispatch", new { reason = "Released to carrier" })).EnsureSuccessStatusCode();
        await CheckBalance(origin, 300, 0, 300);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"{module}/orders/{orderId}/cancel", new { reason = "Already departed" })).StatusCode);
        (await admin.PostAsJsonAsync($"{module}/orders/{orderId}/deliver", new { delivery = new { reference = "Crisis-receipt", confirmedQuantity = 200, receivedBy = "Crisis coordination team", method = "ReceivingStaff" } })).EnsureSuccessStatusCode();
        var ledger = await admin.GetFromJsonAsync<JsonElement>($"{module}/resources/{origin}/history");
        var entries = ledger.EnumerateArray().ToArray();
        Assert.Single(entries, e => e.GetProperty("kind").GetString() == "Opening");
        Assert.Single(entries, e => e.GetProperty("kind").GetString() == "StockReceived");
        var linked = entries.Where(e => e.GetProperty("operationId").GetGuid() == orderId).ToArray();
        Assert.Equal(new[] { "Delivered", "Dispatched", "Reserved" }, linked.Select(e => e.GetProperty("kind").GetString()));
        Assert.All(linked, e => {
            Assert.Equal(crisisId, e.GetProperty("crisisId").GetGuid());
            Assert.False(string.IsNullOrEmpty(e.GetProperty("actorName").GetString()));
            Assert.False(string.IsNullOrEmpty(e.GetProperty("destination").GetString()));
        });

        (await admin.PostAsJsonAsync("/api/v1/admin/users", new { email = "logistics-lk@surakuma.test", name = "Sri Lanka logistics administrator",
            password = fixture.Password, role = Roles.CountryAdministrator, countryCode = "LK" })).EnsureSuccessStatusCode();
        using var sriLanka = await fixture.Login("logistics-lk");
        using var citizen = await fixture.Login("citizen");
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.GetAsync(module)).StatusCode);
        var scoped = await Dashboard(sriLanka);
        Assert.All(scoped.GetProperty("inventory").EnumerateArray(), row => Assert.Equal("LK", row.GetProperty("countryCode").GetString()));
        Assert.All(scoped.GetProperty("depots").EnumerateArray(), row => Assert.Equal("LK", row.GetProperty("countryCode").GetString()));
        Assert.Equal(HttpStatusCode.Forbidden, (await sriLanka.GetAsync($"{module}/resources/{receiver}/history")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await sriLanka.PostAsJsonAsync($"{module}/resources/{receiver}/stock",
            new { operationId = Guid.NewGuid(), delta = 1, reason = "Wrong country" })).StatusCode);

        var transfer = new { operationId = Guid.NewGuid(), kind = "Transfer", resourceId = origin, destinationResourceId = receiver,
            quantity = 120, reason = "Reposition stock" };
        Assert.Equal(HttpStatusCode.Forbidden, (await sriLanka.PostAsJsonAsync($"{module}/orders", transfer)).StatusCode);
        var createdTransfer = await admin.PostAsJsonAsync($"{module}/orders", transfer);
        createdTransfer.EnsureSuccessStatusCode();
        Assert.Matches(@"^TRF-[0-9]{4,}$", (await createdTransfer.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reference").GetString()!);
        await CheckBalance(origin, 300, 120, 180);
        await CheckBalance(receiver, 0, 0, 0);
        var transferId = transfer.operationId;
        (await admin.PostAsJsonAsync($"/api/v1/fulfillment/orders/{transferId}/prepare", new { packedQuantity = 120, note = "Packed." })).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync($"{module}/orders/{transferId}/dispatch", new { reason = "Shipment departed the origin" })).EnsureSuccessStatusCode();
        await CheckBalance(origin, 180, 0, 180);
        await CheckBalance(receiver, 0, 0, 0);
        Assert.Equal(HttpStatusCode.Forbidden, (await sriLanka.PostAsJsonAsync($"{module}/orders/{transferId}/deliver", new { reason = "Wrong country" })).StatusCode);
        var delivery = new { delivery = new { reference = "Transfer-receipt", confirmedQuantity = 120, receivedBy = "Receiving depot", method = "ReceivingStaff" } };
        (await admin.PostAsJsonAsync($"{module}/orders/{transferId}/deliver", delivery)).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync($"{module}/orders/{transferId}/deliver", delivery)).EnsureSuccessStatusCode();
        await CheckBalance(origin, 180, 0, 180);
        await CheckBalance(receiver, 120, 0, 120);
        var received = await admin.GetFromJsonAsync<JsonElement>($"{module}/resources/{receiver}/history");
        Assert.Single(received.EnumerateArray(), e => e.GetProperty("kind").GetString() == "TransferReceived");

        var requests = Enumerable.Range(0, 2).Select(_ => new { operationId = Guid.NewGuid(), kind = "Dispatch",
            resourceId = origin, crisisId, quantity = 120, reason = "Concurrent stock reservation" }).ToArray();
        var reservations = await Task.WhenAll(requests.Select(input => admin.PostAsJsonAsync($"{module}/orders", input)));
        var accepted = Assert.Single(reservations.Select((response, index) => (response, index)), r => r.response.IsSuccessStatusCode);
        await CheckBalance(origin, 180, 120, 60);
        (await admin.PostAsJsonAsync($"{module}/orders/{requests[accepted.index].operationId}/cancel",
            new { reason = "Release unused reservation" })).EnsureSuccessStatusCode();
        await CheckBalance(origin, 180, 0, 180);
    }
}
