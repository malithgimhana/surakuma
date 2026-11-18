using Surakuma.Domain;

namespace Surakuma.Infrastructure;

public static class CountryDeliveryQueries
{
    public static IQueryable<OutboxMessage> DeliveriesInCountry(this CrisisDbContext db, string? countryCode)
    {
        var deliveries = db.Set<OutboxMessage>();
        if (countryCode == null) return deliveries;

        return deliveries.Where(delivery => delivery.FundingCountryCode == countryCode ||
            db.Set<AssistanceRequest>().Any(request => request.Id == delivery.RequestId &&
                db.Set<Crisis>().Any(crisis => crisis.Id == request.CrisisId && crisis.CountryCode == countryCode)));
    }
}
