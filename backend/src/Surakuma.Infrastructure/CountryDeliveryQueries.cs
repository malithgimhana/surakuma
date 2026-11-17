using Surakuma.Domain;

namespace Surakuma.Infrastructure;

public static class CountryDeliveryQueries
{
    public static IQueryable<OutboxMessage> DeliveriesInCountry(this CrisisDbContext db, string? countryCode)
    {
        var deliveries = db.Set<OutboxMessage>();
        if (countryCode == null) return deliveries;

        return from delivery in deliveries
               join request in db.Set<AssistanceRequest>() on delivery.RequestId equals request.Id
               join crisis in db.Set<Crisis>() on request.CrisisId equals crisis.Id
               where crisis.CountryCode == countryCode
               select delivery;
    }
}
