4using Surakuma.Domain;

namespace Surakuma.Application;

public static class CitizenTriage
{
    private static readonly string[] SupplyTimes = ["Out", "WithinSixHours", "WithinDay", "Later", "Unsure"];
    private static readonly string[] ServiceTimes = ["Now", "WithinSixHours", "Today", "Later", "NoDeadline", "Unsure"];
    private static readonly string[] Answers = ["Yes", "No", "Unsure"];
    private static readonly Dictionary<string, (int Points, string Name)> Items = new(StringComparer.Ordinal)
    {
        ["Water"] = (4, "Drinking water"),
        ["BabyFormula"] = (4, "Baby formula"),
        ["CookedMeals"] = (3, "Cooked meals or ready-to-eat food"),
        ["DryRations"] = (2, "Dry rations"),
        ["CookingGas"] = (2, "Cooking gas"),
        ["Clothes"] = (1, "Clothes"),
        ["Blankets"] = (1, "Blankets"),
        ["Hygiene"] = (1, "Hygiene supplies"),
        ["Cleaning"] = (1, "Cleaning supplies")
    };

    public static CitizenIntake Validate(AidCategory category, CitizenIntake intake)
    {
        if (intake.SupplyItems is { } supplies)
        {
            if (!RequiresQuantity(category, intake) || supplies.Length is < 1 or > 4 ||
                supplies.Any(line => line is null || string.IsNullOrWhiteSpace(line.Item) || line.Item.Length > 120 ||
                    string.IsNullOrWhiteSpace(line.Unit) || line.Unit.Length > 32 || line.Quantity is < 0.01m or > 100000m))
                throw new RuleException("Enter one to four items, each with a quantity and unit, for the selected type of help.");
            supplies = supplies.Select(line => line with { Item = line.Item.Trim() }).ToArray();
            if (supplies.Select(line => line.Item).Distinct(StringComparer.OrdinalIgnoreCase).Count() != supplies.Length)
                throw new RuleException("List each item once and enter the full quantity you need.");
            if (category == AidCategory.FoodWater && supplies.Any(line => !Items.ContainsKey(line.Item)))
                throw new RuleException("Select a food and water item from the list.");

            intake = intake with {
                SupplyItems = supplies,
                Need = category == AidCategory.FoodWater ? supplies.MaxBy(line => Items[line.Item].Points)!.Item : intake.Need
            };
        }
        var valid = category switch
        {
            AidCategory.FoodWater => intake.Need is { } item && Items.ContainsKey(item) && SupplyTimes.Contains(intake.Timing),
            AidCategory.Medical => Answers.Contains(intake.Danger) && (intake.Need == "MedicineRefill"
                ? SupplyTimes.Contains(intake.Timing)
                : intake.Need is "MedicalCare" or "MedicalSupplies" && ServiceTimes.Contains(intake.Timing)),
            AidCategory.Shelter => Answers.Contains(intake.SafeTonight) && Answers.Contains(intake.TravelHelp),
            AidCategory.Transportation => intake.Need is "SafePlace" or "MedicalVisit" or "EssentialService" or "Other" &&
                ServiceTimes.Contains(intake.Timing) && intake.VehicleSupport is "None" or "Wheelchair" or "BoardingHelp" or "Unsure",
            AidCategory.Accessibility => intake.Need is "SignLanguage" or "Mobility" or "StepFreeAccess" or "Communication" or "Other" &&
                intake.AccessService is "Registration" or "Distribution" or "Shelter" or "Healthcare" or "Other" && ServiceTimes.Contains(intake.Timing),
            AidCategory.Other => ServiceTimes.Contains(intake.Timing),
            _ => false
        };
        if (!valid) throw new RuleException("Complete the details for the selected type of help.");

        // Keep only the fields used by this help type, including when a client switches types.
        return category switch
        {
            AidCategory.FoodWater => new(intake.Need, intake.Timing, intake.YoungOrPregnant, intake.OlderIllOrDisabled, intake.CutOff,
                SupplyItems: intake.SupplyItems),
            AidCategory.Medical => new(intake.Need, intake.Timing,
                MedicineName: intake.Need == "MedicineRefill" ? intake.MedicineName?.Trim() : null, Danger: intake.Danger,
                SupplyItems: intake.SupplyItems),
            AidCategory.Shelter => new(SafeTonight: intake.SafeTonight, StepFree: intake.StepFree,
                AccessibleToilet: intake.AccessibleToilet, CaregiverSpace: intake.CaregiverSpace, TravelHelp: intake.TravelHelp),
            AidCategory.Transportation => new(intake.Need, intake.Timing, VehicleSupport: intake.VehicleSupport, Destination: intake.Destination?.Trim()),
            AidCategory.Accessibility => new(intake.Need, intake.Timing, AccessService: intake.AccessService),
            _ => new(Timing: intake.Timing)
        };
    }

    public static bool RequiresQuantity(AidCategory category, CitizenIntake intake) =>
        category == AidCategory.FoodWater || category == AidCategory.Medical && intake.Need == "MedicalSupplies";

    public static string SupplyName(AidCategory category, string item) =>
        category == AidCategory.FoodWater ? Items[item].Name : item;

    public static (decimal? Score, Priority Priority) AtIntake(AidCategory category, CitizenIntake intake, int people)
    {
        if (category == AidCategory.FoodWater || category == AidCategory.Medical && intake.Need == "MedicineRefill")
        {
            var score = Factors(category, intake, people).Sum(factor => factor.Points);
            return (score, intake.Danger == "Yes" ? Priority.Critical : PriorityFor(score));
        }
        return (null, intake.Danger == "Yes" ? Priority.Critical :
            intake.SafeTonight == "No" || intake.Timing == "Now" ? Priority.Urgent :
            intake.Danger == "Unsure" || intake.SafeTonight == "Unsure" || intake.Timing == "WithinSixHours" ? Priority.High :
            intake.Timing is "Later" or "NoDeadline" ? Priority.Low : Priority.Medium);
    }

    public static IReadOnlyList<(string Factor, decimal Points)> Factors(AidCategory category, CitizenIntake intake, int people)
    {
        var item = category == AidCategory.FoodWater ? Items[intake.Need!].Points : 4;
        var time = intake.Timing switch { "Out" => 4m, "WithinSixHours" => 3m, "WithinDay" or "Unsure" => 2.5m, _ => 1m };
        var factors = new List<(string, decimal)> { ("item", item), ("time", time), ("people", people >= 6 ? 3 : people >= 3 ? 2 : 1) };
        if (intake.YoungOrPregnant) factors.Add(("youngOrPregnant", 2));
        if (intake.OlderIllOrDisabled) factors.Add(("olderIllOrDisabled", 2));
        if (intake.CutOff) factors.Add(("cutOff", 2));
        return factors;
    }

    public static decimal ScoreAfterWaiting(decimal score, DateTimeOffset submitted, DateTimeOffset now) =>
        Math.Min(17m, score + Math.Max(0, (int)((now - submitted).Ticks / TimeSpan.FromHours(3).Ticks)));

    public static Priority PriorityFor(decimal score) => score switch
    {
        >= 13m => Priority.Critical,
        >= 10m => Priority.Urgent,
        >= 7m => Priority.High,
        >= 5m => Priority.Medium,
        _ => Priority.Low
    };
}
