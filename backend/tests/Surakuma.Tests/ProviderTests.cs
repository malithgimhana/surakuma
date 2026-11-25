using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class ProviderTests
{
    private sealed class Handler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public int Calls
        {
            get; private set;
        }
        public string? Body { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            Body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }
    private sealed class CaptureMappingHandler : HttpMessageHandler
    {
        public Uri? Uri { get; private set; }
        public string? Authorization { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Uri = request.RequestUri;
            Authorization = request.Headers.TryGetValues("Authorization", out var values) ? values.Single() : null;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"features\":[]}", Encoding.UTF8, "application/json") });
        }
    }
    private static IConfiguration Config() => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Ai:OpenAiApiKey"] = "synthetic-test-key", ["Ai:ApprovedSyntheticAccountIds:0"] = SyntheticAccount, ["Email:Provider"] = "Brevo", ["Email:ApiKey"] = "synthetic-test-key", ["Email:Sender"] = "demo@example.test" }).Build();
    [Theory]
    [InlineData("Medical", AidCategory.Medical, true)]
    [InlineData("Unclear", null, true)]
    [InlineData("Shelter", null, false)]
    public async Task IntakeCategoryProviderReceivesFixedSignalsAndCanAbstain(string modelCategory, AidCategory? expected, bool valid)
    {
        const string description = "I need medicine. My name is Example Private and my phone number is 999001234.";
        var json = JsonSerializer.Serialize(new { category = modelCategory });
        var response = JsonSerializer.Serialize(new { status = "completed", output = new[] {
            new { type = "message", content = new[] { new { type = "output_text", text = json } } }
        } });
        var handler = new Handler(HttpStatusCode.OK, response);
        using var http = new HttpClient(handler);
        var provider = new AiProvider(http, Config(), NullLogger<AiProvider>.Instance);
        var advice = await provider.SuggestCategoryAsync(IntakeCategoryHelp.Recognise(description), default);
        Assert.Equal(valid, advice is not null);
        Assert.Equal(expected, advice?.Category);
        Assert.Contains("medicine or medical support", handler.Body);
        Assert.DoesNotContain("Example Private", handler.Body);
        Assert.DoesNotContain("999001234", handler.Body);
    }

    [Theory]
    [InlineData("I ran out of my regular medicine.", AidCategory.Medical)]
    [InlineData("මට බොන්න වතුර අවශ්‍යයි.", AidCategory.FoodWater)]
    [InlineData("අපිට කන්න බොන්න නෑ. ඉක්මනට මොනවහරි කරන්න.", AidCategory.FoodWater)]
    [InlineData("எங்களுக்கு தங்குமிடம் தேவை.", AidCategory.Shelter)]
    [InlineData("हमें एक वाहन चाहिए।", AidCategory.Transportation)]
    [InlineData("मलाई ह्वीलचेयर चाहिन्छ।", AidCategory.Accessibility)]
    [InlineData("I need blankets.", AidCategory.FoodWater)]
    public void IntakeCategoryRecognisesCommonNeedsInSupportedLanguages(string description, AidCategory expected) =>
        Assert.Equal(expected, Assert.Single(IntakeCategoryHelp.Recognise(description)).Category);
    [Theory]
    [InlineData("search", "/pelias/v1/search?boundary.country=LKA&size=5&text=Fort%20%26%20Pettah")]
    [InlineData("reverse", "/pelias/v1/reverse?point.lat=6.9271&point.lon=79.8612&size=5")]
    [InlineData("route", "/openrouteservice/v2/directions/driving-car?start=79.8612,6.9271&end=79.8553,6.9344")]
    public async Task MappingUsesSupportedHeiGitEndpoints(string operation, string pathAndQuery)
    {
        var handler = new CaptureMappingHandler();
        using var http = new HttpClient(handler);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Mapping:ApiKey"] = "  example+/key==  " }).Build();
        var maps = new MappingProvider(http, config);
        var result = await (operation switch
        {
            "search" => maps.GeocodeAsync("Fort & Pettah", default),
            "reverse" => maps.ReverseGeocodeAsync(6.9271, 79.8612, default),
            "route" => maps.RouteAsync(6.9271, 79.8612, 6.9344, 79.8553, default),
            _ => throw new ArgumentOutOfRangeException(nameof(operation))
        });
        Assert.NotNull(result);
        Assert.Equal("https://api.heigit.org" + pathAndQuery, handler.Uri!.AbsoluteUri);
        Assert.Equal("example+/key==", handler.Authorization);
    }
    [Fact]
    public async Task ReverseGeocodingWithoutKeyDoesNotContactProvider()
    {
        var handler = new CaptureMappingHandler();
        using var http = new HttpClient(handler);
        Assert.Null(await new MappingProvider(http, Config()).ReverseGeocodeAsync(6.9, 79.8, default));
        Assert.Null(handler.Uri);
    }
    [Theory]
    [InlineData("IN", "IND")]
    [InlineData("NP", "NPL")]
    public async Task MappingRequestsUseTheSelectedCountry(string country, string boundary)
    {
        var handler = new CaptureMappingHandler();
        using var http = new HttpClient(handler);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Mapping:ApiKey"] = "test-key" }).Build();
        var maps = new MappingProvider(http, config);
        await maps.GeocodeAsync("Synthetic public landmark", default, country);
        Assert.Contains("boundary.country=" + boundary, handler.Uri!.Query);
        await maps.ReverseGeocodeAsync(27.7, 85.3, default, country);
        Assert.Contains("boundary.country=" + boundary, handler.Uri!.Query);
    }
    private const string SyntheticAccount = "authorized-demo-account";
    private const string Triage = """{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"{\"category\":\"FoodWater\",\"signals\":[\"food\",\"drinking water\"]}"}]}],"usage":{"input_tokens":123,"output_tokens":45}}""";

    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable, "{}")]
    [InlineData(HttpStatusCode.OK, "{\"status\":\"completed\",\"output\":[]}")]
    [InlineData(HttpStatusCode.OK, "not-json")]
    public async Task AiFailureAndMalformedOutputBecomeLabelledFallback(HttpStatusCode status, string body)
    {
        var handler = new Handler(status, body);
        using var http = new HttpClient(handler);
        var result = await new AiProvider(http, Config(), NullLogger<AiProvider>.Instance).RecommendAsync(Demo("Household needs food"), default);
        Assert.True(result.Fallback);
        Assert.Equal("Deterministic fallback", result.Provider);
        Assert.Equal(1, handler.Calls);
    }

    [Theory]
    [InlineData(false, SyntheticAccount)]
    [InlineData(true, "unapproved-account")]
    public async Task FullTextRequiresBothSyntheticFlagAndApprovedAccount(bool synthetic, string account)
    {
        var handler = new Handler(HttpStatusCode.OK, "{}");
        using var http = new HttpClient(handler);
        var config = Config();

        var result = await new AiProvider(http, config, NullLogger<AiProvider>.Instance)
            .RecommendAsync(new AssistanceRequest { Synthetic = synthetic, CitizenId = account, Description = "Private name needs food." }, default);
        Assert.True(result.Fallback);
        Assert.Contains("restricted by the citizen data policy", result.Explanation);
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public async Task UnsupportedProviderSettingsCannotSendRequests()
    {
        var handler = new Handler(HttpStatusCode.OK, Triage);
        using var http = new HttpClient(handler);
        var config = Config();
        config["Ai:Tasks:triage:Provider"] = "retired-provider";
        var result = await new AiProvider(http, config, NullLogger<AiProvider>.Instance)
            .RecommendAsync(Demo("Synthetic medical need"), default);
        Assert.True(result.Fallback);
        Assert.Contains("Unsupported AI provider configuration", result.Explanation);
        Assert.Equal(0, handler.Calls);
    }

    [Theory]
    [InlineData("අපේ පවුලට ආහාර සහ පිරිසිදු පානීය ජලය අවශ්‍යයි.")]
    [InlineData("எங்கள் குடும்பத்திற்கு உணவும் சுத்தமான குடிநீரும் தேவை.")]
    [InlineData("बाढ़ के बाद पीने का पानी चाहिए।")]
    [InlineData("बाढीपछि पिउने पानी चाहिन्छ।")]
    public async Task OpenAiUsesStructuredOutputsForApprovedMultilingualScenarios(string description)
    {
        var handler = new Handler(HttpStatusCode.OK, Triage);
        using var http = new HttpClient(handler);
        using var cache = new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions());
        var provider = new AiProvider(http, Config(), NullLogger<AiProvider>.Instance, cache: cache);
        var request = Demo(description);
        request.LocationText = "Private test location";
        request.RequesterContact = "Private test contact";
        var result = await provider.RecommendAsync(request, default);
        Assert.False(result.Fallback);
        Assert.Equal("OpenAI", result.Provider);
        Assert.Equal("gpt-6-luna", result.Model);
        Assert.Equal(AidCategory.FoodWater, result.Category);
        Assert.Contains("drinking water", result.Signals!);
        using var document = JsonDocument.Parse(handler.Body!);
        var root = document.RootElement;
        Assert.False(root.GetProperty("store").GetBoolean());
        Assert.True(root.GetProperty("text").GetProperty("format").GetProperty("strict").GetBoolean());
        using var prompt = JsonDocument.Parse(root.GetProperty("input").GetString()!);
        Assert.Equal(description, prompt.RootElement.GetProperty("description").GetString());
        Assert.DoesNotContain(SyntheticAccount, handler.Body);
        Assert.DoesNotContain("Private test", handler.Body);
        await provider.RecommendAsync(request, default);
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task OpenAiRestrictedTriageAndEmbeddingsSendOnlyAllowlistedSignals()
    {
        var handler = new Handler(HttpStatusCode.OK, Triage);
        using var http = new HttpClient(handler);
        var config = Config();
        config["Ai:EnableRestrictedTriage"] = "true";
        var result = await new AiProvider(http, config, NullLogger<AiProvider>.Instance)
            .RecommendAsync(new AssistanceRequest { CitizenId = "private-citizen", Description = "Private name requires food." }, default);
        Assert.False(result.Fallback);
        Assert.DoesNotContain("Private name", handler.Body);
        Assert.DoesNotContain("private-citizen", handler.Body);

        var embeddingHandler = new Handler(HttpStatusCode.OK, JsonSerializer.Serialize(new
        {
            data = new[] { new { embedding = Enumerable.Repeat(0.5f, 256) } },
            usage = new { prompt_tokens = 5 }
        }));
        using var embeddingHttp = new HttpClient(embeddingHandler);
        var embedding = await new AiProvider(embeddingHttp, config, NullLogger<AiProvider>.Instance)
            .EmbedAsync(AidCategory.FoodWater, ["food", "do not send this string"], default);
        Assert.Equal("text-embedding-3-small", embedding!.Model);
        Assert.Equal(256, embedding.Values.Length);
        Assert.DoesNotContain("do not send", embeddingHandler.Body);
    }

    [Fact]
    public async Task MissingAiKeyReturnsAnActionableFallbackWithoutContactingProvider()
    {
        var handler = new Handler(HttpStatusCode.OK, "{}");
        using var http = new HttpClient(handler);
        var config = Config();
        config["Ai:OpenAiApiKey"] = "";
        var result = await new AiProvider(http, config, NullLogger<AiProvider>.Instance)
            .RecommendAsync(Demo("Household needs food."), default);
        Assert.Equal(0, handler.Calls);
        Assert.True(result.Fallback);
        Assert.Contains("API key", result.Explanation);
    }

    [Fact]
    public async Task AiRateLimitIsExplainedWithoutExposingProviderResponseOrKey()
    {
        var handler = new Handler(HttpStatusCode.TooManyRequests, "Private provider response");
        using var http = new HttpClient(handler);
        var result = await new AiProvider(http, Config(), NullLogger<AiProvider>.Instance)
            .RecommendAsync(Demo("Household needs food."), default);
        Assert.True(result.Fallback);
        Assert.Contains("HTTP 429", result.Explanation);
        Assert.DoesNotContain("Private provider response", result.Explanation);
        Assert.DoesNotContain("synthetic-test-key", result.Explanation);
    }

    [Fact]
    public async Task OptionalAiDraftsRequireConfigurationAndBriefingsSendOnlyAggregates()
    {
        const string response = """{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"{\"text\":\"Review outstanding aid and stock records.\"}"}]}]}""";
        var handler = new Handler(HttpStatusCode.OK, response);
        using var http = new HttpClient(handler);
        var config = Config();
        var provider = new AiProvider(http, config, NullLogger<AiProvider>.Instance);
        var facts = new BriefingCounts(17, 2, 10, 3, 100, 40, 8, 5, 1);
        Assert.Null(await provider.DraftBriefingAsync(facts, default));
        Assert.Null(await provider.DraftTranslationAsync("Synthetic public text", "si", default));
        Assert.Equal(0, handler.Calls);
        config["Ai:OperationalBriefingsEnabled"] = "true";
        var draft = await provider.DraftBriefingAsync(facts, default);
        Assert.Equal("Review outstanding aid and stock records.", draft?.Text);
        using var envelope = JsonDocument.Parse(handler.Body!);
        var prompt = envelope.RootElement.GetProperty("input").GetString()!;
        Assert.Contains("\"activeCases\":17", prompt);
        Assert.DoesNotContain("citizenId", prompt);
        Assert.DoesNotContain("latitude", prompt);
        config["Ai:PublicTranslationEnabled"] = "true";
        using var unavailable = new HttpClient(new Handler(HttpStatusCode.ServiceUnavailable, "{}"));
        Assert.Null(await new AiProvider(unavailable, config, NullLogger<AiProvider>.Instance)
            .DraftTranslationAsync("Synthetic public text", "si", default));
    }

    [Theory]
    [InlineData("Gampaha", "Sri Lanka")]
    [InlineData("Kathmandu", "Nepal")]
    public async Task FloodIllustrationPromptUsesTheAlertLocality(string locality, string country)
    {
        var handler = new Handler(HttpStatusCode.OK, """{"data":[{"b64_json":"UklGRmZha2VXRUJQeA=="}]}""");
        using var http = new HttpClient(handler);
        var provider = new AiProvider(http, Config(), NullLogger<AiProvider>.Instance);

        Assert.NotNull(await provider.IllustratePublicAlertAsync("flood", locality, country, default));
        using var request = JsonDocument.Parse(handler.Body!);
        var prompt = request.RootElement.GetProperty("prompt").GetString();
        Assert.Contains($"inspired by {locality}, {country}", prompt);
        Assert.Contains($"sign reading exactly \"{locality}\"", prompt);
        Assert.Contains("orange inflatable raft", prompt);
    }

    [Theory]
    [InlineData("This notice describes a simulated flood response in downtown Gampaha.", true)]
    [InlineData("Flooding is affecting downtown Gampaha.", false)]
    [InlineData("The Gampaha exercise begins at 09:00.", false)]
    public async Task PublicAlertOverviewPreservesExerciseContextAndOmitsUnverifiedTimes(string description, bool accepted)
    {
        const string official = "This is a flood response exercise in Gampaha town centre.";
        var text = JsonSerializer.Serialize(new { kind = "flood", summary = official, locality = "Gampaha", description });
        var response = JsonSerializer.Serialize(new
        {
            status = "completed",
            output = new[] { new { type = "message", content = new[] { new { type = "output_text", text } } } }
        });
        using var http = new HttpClient(new Handler(HttpStatusCode.OK, response));
        var provider = new AiProvider(http, Config(), NullLogger<AiProvider>.Instance);

        var presentation = await provider.DescribePublicAlertAsync("Gampaha flood", official, "Gampaha town centre", default);

        Assert.Equal(official, presentation?.Summary);
        Assert.Equal(accepted ? description : null, presentation?.Description);
    }

    private static AssistanceRequest Demo(string description) => new()
        { Synthetic = true, CitizenId = SyntheticAccount, Description = description };

    [Theory]
    [InlineData("२० नवंबर को ४ घंटे", true)]
    [InlineData("२१ नवंबर को ४ घंटे", false)]
    [InlineData("२० नवंबर को पाँच घंटे", false)]
    public async Task TranslationDraftPreservesNumericFacts(string draft, bool accepted)
    {
        var body = JsonSerializer.Serialize(new
        {
            status = "completed",
            output = new[] { new { type = "message", content = new[] { new
                { type = "output_text", text = JsonSerializer.Serialize(new { text = draft }) } } } }
        });
        using var http = new HttpClient(new Handler(HttpStatusCode.OK, body));
        var config = Config();
        config["Ai:PublicTranslationEnabled"] = "true";
        var result = await new AiProvider(http, config, NullLogger<AiProvider>.Instance)
            .DraftTranslationAsync("20 November for 4 hours", "hi", default);
        Assert.Equal(accepted, result is not null);
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests, "Retry")]
    [InlineData(HttpStatusCode.ServiceUnavailable, "Review")]
    [InlineData(HttpStatusCode.BadRequest, "Failed")]
    public async Task EmailDistinguishesSafeRetriesFromUnknownOutcomes(HttpStatusCode status, string state)
    {
        using var http = new HttpClient(new Handler(status, "{}"));
        var provider = new EmailProvider(http, Config());
        var result = await provider.SendAsync("demo@example.test", new CitizenEmailUpdate("Synthetic message"), Guid.NewGuid(), default);
        Assert.Equal(state, result.State);
    }

    [Fact]
    public async Task BrevoReceivesBrandedLocalizedStatusEmailWithRequestLink()
    {
        var handler = new Handler(HttpStatusCode.Created, """{"messageId":"demo-id"}""");
        using var http = new HttpClient(handler);
        var config = Config();
        config["Email:PortalBaseUrl"] = "https://surakuma.example.test";
        var entry = new OutboxMessage
        {
            RequestId = Guid.NewGuid(),
            Message = "SK-27B4E8A190: Your request has been approved for assistance.",
            TamilMessage = "SK-27B4E8A190: அங்கீகரிக்கப்பட்டது."
        };
        var result = await new EmailProvider(http, config).SendAsync(
            "demo@example.test", CitizenEmailUpdate.FromOutbox(entry, "ta"), entry.Id, default);

        Assert.Equal(new DeliveryResult("Sent", "demo-id"), result);
        using var json = JsonDocument.Parse(handler.Body!);
        var payload = json.RootElement;
        Assert.Equal("உங்கள் கோரிக்கை அங்கீகரிக்கப்பட்டது", payload.GetProperty("subject").GetString());
        var text = payload.GetProperty("textContent").GetString();
        var html = payload.GetProperty("htmlContent").GetString();
        var requestUrl = $"https://surakuma.example.test/app/requests/{entry.RequestId:D}";
        Assert.Contains(requestUrl, text);
        Assert.Contains("குறிப்பு எண்: SK-27B4E8A190", text);
        Assert.Contains($"href=\"{requestUrl}\"", html);
        Assert.Contains("Humanitarian Response Platform", html);
        Assert.Contains("bgcolor=\"#EF7865\"", html);
        Assert.DoesNotContain("<img", html);
        Assert.Contains("lang=\"ta\"", html);
        Assert.Equal(entry.Id.ToString(), payload.GetProperty("headers").GetProperty("X-Surakuma-Event").GetString());
    }
}
