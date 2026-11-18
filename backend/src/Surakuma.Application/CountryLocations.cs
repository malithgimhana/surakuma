using System.Text.Json;
using Surakuma.Domain;

namespace Surakuma.Application;

internal static class CountryLocations
{
    private static readonly Lazy<JsonDocument> Boundaries = new(() =>
    {
        using var content = typeof(CountryLocations).Assembly.GetManifestResourceStream("CountryBoundaries.json")
            ?? throw new InvalidOperationException("Country boundaries are unavailable.");
        return JsonDocument.Parse(content);
    });

    public static void Validate(string country, double latitude, double longitude)
    {
        if (!double.IsFinite(latitude) || !double.IsFinite(longitude) || latitude is < -90 or > 90 ||
            longitude is < -180 or > 180 || !Boundaries.Value.RootElement.TryGetProperty(country, out var geometry))
            throw new RuleException("Choose valid coordinates in the selected country.");
        var coordinates = geometry.GetProperty("coordinates");
        var inside = geometry.GetProperty("type").GetString() == "Polygon"
            ? InPolygon(coordinates, longitude, latitude)
            : coordinates.EnumerateArray().Any(polygon => InPolygon(polygon, longitude, latitude));
        if (!inside) throw new RuleException("The resource coordinates fall outside the selected country.");
    }

    private static bool InPolygon(JsonElement polygon, double x, double y) =>
        InRing(polygon[0], x, y) && !polygon.EnumerateArray().Skip(1).Any(ring => InRing(ring, x, y));

    private static bool InRing(JsonElement ring, double x, double y)
    {
        var previous = ring[ring.GetArrayLength() - 1];
        var inside = false;
        foreach (var point in ring.EnumerateArray())
        {
            var px = previous[0].GetDouble();
            var py = previous[1].GetDouble();
            var cx = point[0].GetDouble();
            var cy = point[1].GetDouble();
            if ((py > y) != (cy > y) && x < (cx - px) * (y - py) / (cy - py) + px)
                inside = !inside;
            previous = point;
        }
        return inside;
    }
}
