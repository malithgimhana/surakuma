using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Api.Controllers;

public sealed record DeliveryStateCount(string State, int Count);
public sealed record SystemConfigurationStatus(bool DemonstrationMode, DateTimeOffset CheckedAt,
    IntegrationConfigurationStatus[] Integrations, List<DeliveryStateCount> NotificationQueue);

[ApiController, Authorize, Route("api/v1/admin/system")]
public sealed class SystemController(AccessService access, CrisisDbContext db, IConfiguration config, IWebHostEnvironment environment) : ControllerBase
{
    [HttpGet, ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<SystemConfigurationStatus> Get(CancellationToken ct)
    {
        if (!await access.IsAdmin(ct))
            throw new AccessDeniedException();
        var queue = await db.Set<OutboxMessage>().GroupBy(x => x.State).OrderBy(g => g.Key)
            .Select(g => new DeliveryStateCount(g.Key, g.Count())).ToListAsync(ct);
        return new(environment.IsDevelopment(), DateTimeOffset.UtcNow, IntegrationConfiguration.Describe(config), queue);
    }
}
