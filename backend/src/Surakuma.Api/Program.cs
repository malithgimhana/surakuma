using System.Security.Cryptography;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.IdentityModel.Tokens;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

var builder = WebApplication.CreateBuilder(args);
var dataPath = Path.GetFullPath(builder.Configuration["Storage:DevelopmentDataPath"] ?? "../../data",
    builder.Environment.ContentRootPath);
if (builder.Environment.IsDevelopment())
{
    Directory.CreateDirectory(dataPath);
    string settingsPath = Path.Combine(dataPath, "development-settings.json");
    if (!File.Exists(settingsPath))
        File.WriteAllText(settingsPath, JsonSerializer.Serialize(new
        {
            Jwt = new
            {
                Key = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64))
            }
        }, new JsonSerializerOptions { WriteIndented = true }));
    builder.Configuration.AddJsonFile(settingsPath, false, false).AddEnvironmentVariables();
}
if ((builder.Configuration["Jwt:Key"]?.Length ?? 0) < 32) throw new InvalidOperationException("Configure a JWT signing key of at least 32 characters using environment variables or development secrets.");
builder.Services.AddDbContext<CrisisDbContext>(o => o.UseSqlServer(builder.Configuration.GetConnectionString("Default")));
builder.Services.AddIdentityCore<AppUser>(o => { o.Password.RequiredLength = 10; o.User.RequireUniqueEmail = true; o.Lockout.MaxFailedAccessAttempts = 5; o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(10); })
    .AddRoles<IdentityRole>().AddEntityFrameworkStores<CrisisDbContext>().AddDefaultTokenProviders();
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o => {
o.TokenValidationParameters = new TokenValidationParameters
{
    ValidateIssuer = true,
    ValidateAudience = true,
    ValidateIssuerSigningKey = true,
    ValidateLifetime = true,
    ValidIssuer = builder.Configuration["Jwt:Issuer"],
    ValidAudience = builder.Configuration["Jwt:Audience"],
    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]!)),
    ClockSkew = TimeSpan.FromSeconds(30)
};
o.Events = new JwtBearerEvents
{
    OnTokenValidated = async context =>
    {
        var users = context.HttpContext.RequestServices.GetRequiredService<UserManager<AppUser>>();
        var userId = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
        var stamp = context.Principal?.FindFirstValue("security_stamp");
        var user = userId is null ? null : await users.FindByIdAsync(userId);
        if (user is null || user.Disabled || string.IsNullOrEmpty(stamp) || stamp != await users.GetSecurityStampAsync(user))
            context.Fail("Session is no longer valid.");
    }
};
});
builder.Services.Configure<DataProtectionTokenProviderOptions>(o => o.TokenLifespan = TimeSpan.FromHours(1));
builder.Services.AddTransient<ProviderObservationHandler>();
builder.Services.AddAuthorization();
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<IStore, EfStore>();
builder.Services.AddScoped<ICurrentActor, CurrentActor>();
builder.Services.AddScoped<AccessService>();
builder.Services.AddSingleton(new ShelterOperationalPolicy(builder.Configuration.GetValue("ShelterDashboard:StaleAfterHours", 168)));
builder.Services.AddScoped<Operations>();
builder.Services.AddScoped<VolunteerAvailability>();
builder.Services.AddScoped<RequestIntelligence>();
builder.Services.AddScoped<CaseCommunications>();
builder.Services.AddSingleton(new ResourceUnitCatalog(
    builder.Configuration.GetSection("ResourceUnits:Additional").Get<ResourceUnit[]>() ?? []));
builder.Services.AddScoped<FundingService>();
builder.Services.AddScoped<DecisionSupportService>();
builder.Services.AddScoped<SupplySupportService>();
builder.Services.AddScoped<InternalNotifications>();
builder.Services.AddScoped<AuthenticationService>();
builder.Services.AddScoped<IAllocationPolicy, ConstraintAllocationPolicy>();
builder.Services.AddScoped<IAllocationStrategy, RankedAllocationStrategy>();
builder.Services.AddHttpClient<IAiProvider, AiProvider>();
builder.Services.AddHttpClient(AiProvider.AlertImageClient, c =>
{
    c.Timeout = TimeSpan.FromSeconds(100);
    c.MaxResponseContentBufferSize = 3 * 1024 * 1024;
}).RedactLoggedHeaders(["Authorization"]);
foreach (var task in AiProvider.Tasks)
{
    var settings = builder.Configuration.GetSection("Ai:Tasks:" + task);
    builder.Services.AddHttpClient($"surakuma-ai-OpenAI-{task}", c =>
    {
        c.Timeout = Timeout.InfiniteTimeSpan;
        c.MaxResponseContentBufferSize = 128 * 1024;
    }).RedactLoggedHeaders(["Authorization"])
        .AddHttpMessageHandler<ProviderObservationHandler>().AddSurakumaResilience(ai: true,
            attemptTimeout: TimeSpan.FromSeconds(Math.Clamp(settings.GetValue("TimeoutSeconds", 20), 2, 30)),
            retries: Math.Clamp(settings.GetValue("Retries", task == "intake-category" ? 0 : 1), 0, 2),
            breakDuration: TimeSpan.FromSeconds(Math.Clamp(settings.GetValue("BreakSeconds", 30), 5, 300)));
}
builder.Services.AddHttpClient<EmailProvider>(c => c.Timeout = Timeout.InfiniteTimeSpan).AddHttpMessageHandler<ProviderObservationHandler>().AddSurakumaResilience(email: true);
builder.Services.AddHttpClient(SecurityEmailWorker.ClientName, c => c.Timeout = TimeSpan.FromSeconds(20));
builder.Services.AddScoped<IEmailProvider>(sp => EmailProviderFactory.Create(sp.GetRequiredService<IConfiguration>(), sp.GetRequiredService<EmailProvider>()));
builder.Services.AddHttpClient<IMappingProvider, MappingProvider>(c => c.Timeout = Timeout.InfiniteTimeSpan).AddHttpMessageHandler<ProviderObservationHandler>().AddSurakumaResilience();
builder.Services.AddHostedService<NotificationWorker>();
builder.Services.AddSingleton<BrowserPushSettings>();
builder.Services.AddHttpClient(BrowserPushWorker.ClientName, c => c.Timeout = TimeSpan.FromSeconds(15))
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false })
    .RedactLoggedHeaders(_ => true)
    .RemoveAllLoggers();
if (!builder.Environment.IsEnvironment("Testing")) builder.Services.AddHostedService<BrowserPushWorker>();
if (!builder.Environment.IsEnvironment("Testing") || builder.Configuration.GetValue<bool>("Ai:EnableTestWorker"))
    builder.Services.AddHostedService<RequestAnalysisWorker>();
if (!builder.Environment.IsEnvironment("Testing")) { builder.Services.AddHostedService<AdministrationWorker>(); builder.Services.AddHostedService<SecurityEmailWorker>(); }
if (!builder.Environment.IsEnvironment("Testing")) builder.Services.AddHostedService<PublicAlertVisualWorker>();
builder.Services.AddMemoryCache();
builder.Services.AddControllers().AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter(null, false)));
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options => options.CustomSchemaIds(SchemaId));
var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? ["http://localhost:5173", "http://127.0.0.1:5173", "https://localhost:5173"];
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    int globalPermitLimit = builder.Configuration.GetValue("RateLimits:GlobalPermitLimit", 240);
    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "local", _ => new FixedWindowRateLimiterOptions { PermitLimit = globalPermitLimit, Window = TimeSpan.FromMinutes(1) }));
    o.AddFixedWindowLimiter("auth", x => { x.PermitLimit = builder.Configuration.GetValue("RateLimits:AuthPermitLimit", 20); x.Window = TimeSpan.FromMinutes(1); });
    o.AddFixedWindowLimiter("maps", x => { x.PermitLimit = 30; x.Window = TimeSpan.FromMinutes(1); });
    o.AddFixedWindowLimiter("ai-drafts", x => { x.PermitLimit = 20; x.Window = TimeSpan.FromMinutes(1); });
});
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 5 * 1024 * 1024);
var app = builder.Build();
bool assessment = args.Contains("--seed-assessment");
bool setup = args.Contains("--setup");
if (args.Contains("--migrate") || setup || assessment)
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
    // A fresh LocalDB install imports the full regional reference snapshot.
    db.Database.SetCommandTimeout(TimeSpan.FromMinutes(5));
    var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
    if (setup || assessment)
    {
        var target = new SqlConnectionStringBuilder(db.Database.GetConnectionString());
        if (!app.Environment.IsDevelopment() || !target.IntegratedSecurity ||
            !target.DataSource.StartsWith(@"(localdb)\", StringComparison.OrdinalIgnoreCase) ||
            string.IsNullOrWhiteSpace(target.InitialCatalog) || !string.IsNullOrEmpty(target.AttachDBFilename))
            throw new InvalidOperationException("Setup requires a named LocalDB database and Windows authentication in Development.");
        if (assessment && !target.InitialCatalog.StartsWith("Surakuma_Assessment_", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Assessment seeding requires a fresh Surakuma_Assessment_ database.");
        if (assessment && (string.IsNullOrWhiteSpace(app.Configuration["Seed:Password"]) ||
            File.Exists(Path.Combine(dataPath, SeedData.AssessmentAccessFile))))
            throw new InvalidOperationException("Assessment seeding requires a generated password and a fresh private data folder.");

        var creator = db.GetService<IRelationalDatabaseCreator>();
        if (await creator.ExistsAsync())
        {
            if (assessment || (await db.Database.GetPendingMigrationsAsync()).Any())
                throw new InvalidOperationException("Setup left the existing database unchanged. Use a new database name, or review the migrations and use the documented manual migration process.");
            Console.WriteLine("Existing database is current. Setup left its records unchanged.");
            return;
        }
        // CREATE DATABASE also rejects a name claimed after the existence check.
        await creator.CreateAsync();
    }
    await db.Database.MigrateAsync();
    if (assessment)
    {
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        await SeedData.Initialise(db, users, roles, app.Configuration, dataPath);
    }
    else if (app.Environment.IsDevelopment())
        await SeedData.EnsureRoles(roles);
    Console.WriteLine(assessment ? "Database migrations and assessment seed completed." : "Database migrations completed.");
    return;
}
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    try
    {
        await next();
    }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
    catch (Exception ex)
    {
        if (context.Response.HasStarted)
            throw;
        var root = ex;
        while (root.InnerException is not null)
            root = root.InnerException;
        int status = root is SqlException { Number: 1205 or 2601 or 2627 } ? 409 : ex switch
        {
            MissingException => 404,
            AccessDeniedException => 403,
            RuleException => 400,
            DbUpdateConcurrencyException => 409,
            DbUpdateException => 409,
            _ => 500
        };
        var route = (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText;
        app.Logger.LogWarning("Request failed: {Method} {Route}, {FailureType}, SQL {SqlNumber}, status {Status}, trace {TraceId}",
            context.Request.Method, route, ex.GetType().Name, (root as SqlException)?.Number, status, context.TraceIdentifier);
        context.Response.StatusCode = status;
        await Results.Problem(statusCode: status, title: status switch
        {
            400 => "Please check your input",
            403 => "Access denied",
            404 => "Record not found",
            409 => "The record changed or conflicts with an existing operation",
            _ => "Service temporarily unavailable"
        }, detail: ex is RuleException ? ex.Message : "Refresh and try again. If the problem continues, contact the project administrator.", extensions: new Dictionary<string, object?> { ["traceId"] = context.TraceIdentifier }).ExecuteAsync(context);
    }
});
app.UseHttpsRedirection();
app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.Use(async (context, next) => {
    try { await next(); }
    catch (AccessDeniedException) { context.Items["AdminDenied"] = true; throw; }
    finally {
        if ((context.Response.StatusCode == 403 || context.Items.ContainsKey("AdminDenied")) && context.Request.Path.StartsWithSegments("/api/v1/admin") && context.User.Identity?.IsAuthenticated == true) {
            using var scope = app.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            db.Add(new ServiceObservation { Service = "AdministrativeAccess", ActorId = context.User.FindFirstValue(ClaimTypes.NameIdentifier), Success = false });
            await db.SaveChangesAsync();
        }
    }
});
app.UseAuthorization();
if (app.Environment.IsDevelopment()) { app.UseSwagger(); app.UseSwaggerUI(); }
app.MapGet("/api/v1/health", () => Results.Ok(new { status = "healthy", service = "Surakuma", demo = app.Environment.IsDevelopment() })).AllowAnonymous();
app.MapGet("/api/v1/ready", async (CrisisDbContext db, CancellationToken ct) =>
{
    try
    {
        return await db.Database.CanConnectAsync(ct) ? Results.Ok(new
        {
            status = "ready"
        }) : Results.Problem("SQL Server is unavailable. Follow README setup instructions.", statusCode: 503);
    }
    catch { return Results.Problem("SQL Server is unavailable. Follow README setup instructions.", statusCode: 503); }
}).AllowAnonymous();
app.MapControllers();
app.Run();

static string SchemaId(Type type)
{
    if (type.IsGenericType)
        return string.Concat(type.GetGenericArguments().Select(SchemaId)) + type.Name.Split('`')[0];
    return type.IsNested ? type.DeclaringType!.Name + "." + type.Name : type.Name.Replace("[]", "Array");
}
public partial class Program;
