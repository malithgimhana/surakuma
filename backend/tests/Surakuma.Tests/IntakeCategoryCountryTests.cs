using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Tests;

public sealed class IntakeCategoryCountryTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    private static readonly (string Description, AidCategory Expected)[] Examples =
    [
        ("We have to sleep in our car tonight after the floods.", AidCategory.Shelter),
        ("අද රෑ අපි කොහෙද නිදා ගන්නේ?", AidCategory.Shelter),
        ("என் மாத்திரைகள் எல்லாம் முடிந்துவிட்டன.", AidCategory.Medical),
        ("कोई मुझे मेरे रिश्तेदार के घर तक छोड़ दे।", AidCategory.Transportation),
        ("म केही देख्न सक्दिनँ। फाराम पढ्न साथ चाहिन्छ।", AidCategory.Accessibility)
    ];

    [Fact]
    public async Task CategoryEndpointUsesLunaForDescriptionsInAllFiveLanguagesAndAllThreeCountries()
    {
        using var transport = new CategoryTransport();
        using var factory = fixture.Factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Ai:OpenAiApiKey"] = "synthetic-transport-only",
                ["Ai:Tasks:intake-category:Provider"] = "OpenAI",
                ["Ai:OpenAiModel"] = "global-model-override"
            }));
            builder.ConfigureServices(services => services.AddHttpClient("surakuma-ai-OpenAI-intake-category")
                .ConfigurePrimaryHttpMessageHandler(() => transport));
        });
        using var citizen = await fixture.Login("citizen");
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });
        client.DefaultRequestHeaders.Authorization = citizen.DefaultRequestHeaders.Authorization;

        foreach (var country in new[] { "LK", "IN", "NP" })
        {
            foreach (var example in Examples)
            {
                Assert.Empty(IntakeCategoryHelp.Recognise(example.Description));
                using var reply = await client.PostAsJsonAsync("/api/v1/requests/category-suggestion", new
                {
                    countryCode = country, description = example.Description + " test@example.test 071 234 5678 https://example.test/example",
                    draftKey = Guid.NewGuid().ToString("N"), useDescriptionWithAi = true
                });
                reply.EnsureSuccessStatusCode();
                var result = await reply.Content.ReadFromJsonAsync<JsonElement>();
                Assert.Equal(example.Expected.ToString(), result.GetProperty("recommendation").GetString());
                Assert.Equal("OpenAI", result.GetProperty("source").GetString());
                Assert.Equal("gpt-6-luna", result.GetProperty("model").GetString());
                Assert.Equal(country, transport.LatestCountry);
            }
        }

        using var oldClient = await client.PostAsJsonAsync("/api/v1/requests/category-suggestion", new
        {
            countryCode = "LK", description = Examples[0].Description, draftKey = Guid.NewGuid().ToString("N")
        });
        oldClient.EnsureSuccessStatusCode();
        var oldResult = await oldClient.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("NoMatch", oldResult.GetProperty("source").GetString());
        Assert.Equal(15, transport.Calls);
    }

    private sealed class CategoryTransport : HttpMessageHandler
    {
        public int Calls { get; private set; }
        public string? LatestCountry { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++;
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));
            Assert.Equal("gpt-6-luna", body.RootElement.GetProperty("model").GetString());
            Assert.False(body.RootElement.GetProperty("store").GetBoolean());
            using var input = JsonDocument.Parse(body.RootElement.GetProperty("input").GetString()!);
            LatestCountry = input.RootElement.GetProperty("countryCode").GetString();
            var description = input.RootElement.GetProperty("description").GetString();
            Assert.DoesNotContain("test@example.test", description);
            Assert.DoesNotContain("071 234 5678", description);
            Assert.DoesNotContain("https://example.test", description);
            var expected = Assert.Single(Examples, sample => sample.Description.Normalize() == description).Expected;
            var text = JsonSerializer.Serialize(new { category = expected.ToString() });
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(new
            {
                status = "completed",
                output = new[] { new { type = "message", content = new[] { new { type = "output_text", text } } } }
            }) };
        }
    }
}
