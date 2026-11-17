using Surakuma.Domain;

namespace Surakuma.Application;

public static class QuantityUnits
{
    public static bool IsMeasured(string? unit) => (unit ?? "").Trim().ToLowerInvariant() is
        "kg" or "kilogram" or "kilograms" or "l" or "liter" or "liters" or "litre" or "litres";

    public static void ValidateWhole(decimal quantity, string? unit)
    {
        if (!IsMeasured(unit) && quantity != decimal.Truncate(quantity))
            throw new RuleException("Quantity for countable units must be a whole number.");
    }

    public static void ValidateInventory(decimal quantity, string? unit)
    {
        if (quantity < 0 || quantity != decimal.Round(quantity, 2))
            throw new RuleException("Enter a non-negative quantity with at most two decimal places.");
        ValidateWhole(quantity, unit);
    }
}
