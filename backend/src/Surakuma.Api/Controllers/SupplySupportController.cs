using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Api.Controllers;

[ApiController, Authorize, Route("api/v1/supply-support/{country}"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class SupplySupportController(SupplySupportService service) : ControllerBase
{
    [HttpGet]
    public Task<SupplyWorkspace> Workspace([RegularExpression("LK|IN|NP")] string country, CancellationToken ct, string? search = null)
        => service.Workspace(country, ct, search);
    [HttpPost]
    public Task<SupplyRequest> RequestSupplies([RegularExpression("LK|IN|NP")] string country, SupplyRequestInput input, CancellationToken ct)
        => service.Request(country, input, ct);
    [HttpPost("{id:guid}/cancel")]
    public Task<SupplyRequest> Cancel([RegularExpression("LK|IN|NP")] string country, Guid id, ReviewNote input, CancellationToken ct)
        => service.Cancel(country, id, input, ct);
    [HttpGet("contributions/{id:guid}/receipts")]
    public Task<PartnerReceiptOptions> ReceiptOptions([RegularExpression("LK|IN|NP")] string country, Guid id, CancellationToken ct)
        => service.ReceiptOptions(country, id, ct);
    [HttpPost("contributions/{id:guid}/receipts")]
    public Task<PartnerStockReceipt> Receive([RegularExpression("LK|IN|NP")] string country, Guid id, PartnerReceiptInput input, CancellationToken ct)
        => service.Receive(country, id, input, ct);
}
