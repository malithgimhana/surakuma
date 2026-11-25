using Surakuma.Domain;

namespace Surakuma.Application;

public static class QuantityUnits
{
    public const string Household = "household";
    public static readonly string[] Pieces = ["pieces", "piece", "items", "item", "pcs"];
    public static readonly string[] Packs = ["packs", "pack"];
    public static readonly string[] Kilograms = ["kg", "kilogram", "kilograms"];
    public static readonly string[] Grams = ["g", "gram", "grams"];
    public static readonly string[] Litres = ["l", "liter", "liters", "litre", "litres"];
    public static readonly string[] Millilitres = ["ml", "milliliter", "milliliters", "millilitre", "millilitres"];
    public static readonly string[] Persons = ["persons", "person", "people"];

    public static string Normalize(string? unit)
    {
        var key = (unit ?? "").Trim().ToLowerInvariant();
        if (Pieces.Contains(key)) return "pieces";
        if (Packs.Contains(key)) return "packs";
        if (Kilograms.Contains(key)) return "kg";
        if (Grams.Contains(key)) return "g";
        if (Litres.Contains(key)) return "l";
        if (Millilitres.Contains(key)) return "ml";
        return Persons.Contains(key) ? "persons" : key;
    }

    // Canonical reporting units retain the entire precision of stored inventory.
    public static string BaseUnit(string? unit) => Normalize(unit) switch { "kg" => "g", "l" => "ml", var key => key };
    private static decimal Factor(string? unit) => Normalize(unit) is "kg" or "l" ? 1000m : 1m;
    public static bool Compatible(string? from, string? to) => BaseUnit(from) is { Length: > 0 } key && key == BaseUnit(to);
    public static bool IsMeasured(string? unit) => BaseUnit(unit) is "g" or "ml";

    public static decimal Convert(decimal amount, string? from, string? to)
    {
        if (!Compatible(from, to))
            throw new RuleException("The measurement units are incompatible. Packs and pieces are separate units.");
        return amount * Factor(from) / Factor(to);
    }

    public static decimal ForInventory(decimal amount, string? from, string to)
    {
        var converted = Convert(amount, from, to);
        ValidateInventory(converted, to);
        return converted;
    }

    public static decimal FloorToInventory(decimal amount, string? unit) =>
        IsMeasured(unit) ? decimal.Floor(amount * 100) / 100 : decimal.Floor(amount);

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

    public static void ValidateStockLevel(decimal quantity, string? unit)
    {
        if (Normalize(unit) == "l" && quantity != decimal.Truncate(quantity))
            throw new RuleException("Enter a whole number of litres for opening stock or the low-stock threshold. Use millilitres for smaller amounts.");
        ValidateInventory(quantity, unit);
    }
}

public sealed record ResourceUnit(string Code, string Label, bool AllowsFractions, AidCategory[]? StockCategories = null);

public sealed class ResourceUnitCatalog
{
    private static readonly AidCategory[] AllStockCategories = Enum.GetValues<AidCategory>();

    private readonly Dictionary<string, ResourceUnit> units = new(StringComparer.Ordinal)
    {
        ["pieces"] = new("pieces", "Pieces", false, AllStockCategories),
        ["packs"] = new("packs", "Packs", false, [AidCategory.FoodWater, AidCategory.Medical, AidCategory.Shelter, AidCategory.Accessibility, AidCategory.Other]),
        ["kg"] = new("kg", "Kilograms (kg)", true, [AidCategory.FoodWater, AidCategory.Other]),
        ["g"] = new("g", "Grams (g)", true, [AidCategory.FoodWater]),
        ["l"] = new("l", "Litres (L)", true, [AidCategory.FoodWater, AidCategory.Medical, AidCategory.Transportation, AidCategory.Other]),
        ["ml"] = new("ml", "Millilitres (mL)", true, [AidCategory.FoodWater, AidCategory.Medical]),
        ["persons"] = new("persons", "Persons", false, []),
        ["bags"] = new("bags", "Bags", false, [AidCategory.FoodWater, AidCategory.Other]),
        ["bottles"] = new("bottles", "Bottles", false, [AidCategory.FoodWater, AidCategory.Medical, AidCategory.Other]),
        ["cartons"] = new("cartons", "Cartons", false, [AidCategory.FoodWater, AidCategory.Other]),
        ["boxes"] = new("boxes", "Boxes", false, [AidCategory.Medical, AidCategory.Other]),
        ["vials"] = new("vials", "Vials", false, [AidCategory.Medical]),
        ["ampoules"] = new("ampoules", "Ampoules", false, [AidCategory.Medical]),
        ["sets"] = new("sets", "Sets", false, [AidCategory.Shelter, AidCategory.Transportation, AidCategory.Accessibility, AidCategory.Other]),
        ["rolls"] = new("rolls", "Rolls", false, [AidCategory.Shelter]),
        ["pairs"] = new("pairs", "Pairs", false, [AidCategory.Accessibility, AidCategory.Other])
    };

    public ResourceUnitCatalog(IEnumerable<ResourceUnit> additional)
    {
        foreach (var unit in additional)
        {
            var code = QuantityUnits.Normalize(unit.Code);
            if (code.Length is < 1 or > 32 || code.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-') ||
                code == QuantityUnits.Household || unit.AllowsFractions || string.IsNullOrWhiteSpace(unit.Label) ||
                !units.TryAdd(code, unit with { Code = code }))
                throw new InvalidOperationException("Additional resource units need a unique code and label and must count whole units.");
        }
    }

    public IReadOnlyCollection<ResourceUnit> Definitions => units.Values;

    public string Require(string? unit)
    {
        var code = QuantityUnits.Normalize(unit);
        return units.ContainsKey(code) ? code : throw new RuleException("Choose a configured measurement unit.");
    }

    public void EnsureStockCategory(string code, AidCategory? category)
    {
        if (units[code].StockCategories is not { Length: > 0 } categories ||
            category is { } selected && !categories.Contains(selected))
            throw new RuleException("Choose a stock unit suitable for the selected aid category.");
    }
}
