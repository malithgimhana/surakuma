using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Api.Controllers;

public sealed record PushEndpointInput([Required, StringLength(1500)] string Endpoint);
public sealed record PushSubscribeInput([Required, StringLength(1500)] string Endpoint,
    [Required, StringLength(90)] string PublicKey, [Required, StringLength(90)] string AuthSecret);

[ApiController, Authorize, Route("api/v1/browser-push"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class BrowserPushController(IStore store, AccessService access, BrowserPushSettings settings,
    IDataProtectionProvider protection) : ControllerBase
{
    [HttpGet]
    public object Configuration() => new { enabled = settings.Enabled, publicKey = settings.Enabled ? settings.PublicKey : null };

    [HttpPost("status")]
    public async Task<object> Status(PushEndpointInput input, CancellationToken ct) =>
        new { subscribed = await Find(input.Endpoint, ct) is { } browser && browser.UserId == access.UserId };

    [HttpPost("subscribe")]
    public Task<bool> Subscribe(PushSubscribeInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        if (!settings.Enabled) throw new RuleException("Browser notifications are unavailable on this server.");
        if (!BrowserPushSettings.ValidEndpoint(input.Endpoint) || !BrowserPushSettings.ValidKey(input.PublicKey, 65, true) ||
            !BrowserPushSettings.ValidKey(input.AuthSecret, 16))
            throw new RuleException("This browser’s push subscription is invalid or unsupported.");
        var existing = await Find(input.Endpoint, ct);
        if (existing is not null && existing.UserId != access.UserId) throw new AccessDeniedException();
        var browser = existing ?? new BrowserPushSubscription { UserId = access.UserId,
            EndpointHash = BrowserPushSettings.Hash(input.Endpoint), EnabledAt = DateTimeOffset.UtcNow };
        var protector = BrowserPushSettings.Protector(protection);
        browser.Endpoint = protector.Protect(input.Endpoint);
        browser.PublicKey = protector.Protect(input.PublicKey);
        browser.AuthSecret = protector.Protect(input.AuthSecret);
        if (existing is null) store.Add(browser);
        return true;
    }, ct);

    [HttpPost("unsubscribe")]
    public Task<bool> Unsubscribe(PushEndpointInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        if (await Find(input.Endpoint, ct) is { } browser && browser.UserId == access.UserId)
            store.Remove(browser);
        return true;
    }, ct);

    private async Task<BrowserPushSubscription?> Find(string endpoint, CancellationToken ct)
    {
        var hash = BrowserPushSettings.Hash(endpoint);
        return (await store.ListAsync(store.Query<BrowserPushSubscription>().Where(x => x.EndpointHash == hash), ct)).SingleOrDefault();
    }
}
