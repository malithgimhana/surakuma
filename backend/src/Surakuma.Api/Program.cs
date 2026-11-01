using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

var builder = WebApplication.CreateBuilder(args);
var dataPath = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "../../data"));
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
            },
            Seed = new
            {
                Password = "Sk!" + Convert.ToHexString(RandomNumberGenerator.GetBytes(12)) + "a9"
            }
        }, new JsonSerializerOptions { WriteIndented = true }));
    builder.Configuration.AddJsonFile(settingsPath, false, false).AddEnvironmentVariables();
}
if ((builder.Configuration["Jwt:Key"]?.Length ?? 0) < 32) throw new InvalidOperationException("Configure a JWT signing key of at least 32 characters using environment variables or development secrets.");
builder.Services.AddDbContext<CrisisDbContext>(o => o.UseSqlServer(builder.Configuration.GetConnectionString("Default")));
builder.Services.AddIdentityCore<AppUser>(o => { o.Password.RequiredLength = 10; o.User.RequireUniqueEmail = true; o.Lockout.MaxFailedAccessAttempts = 5; o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(10); })
    .AddRoles<IdentityRole>().AddEntityFrameworkStores<CrisisDbContext>().AddDefaultTokenProviders();
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o => o.TokenValidationParameters = new TokenValidationParameters
{
    ValidateIssuer = true,
    ValidateAudience = true,
    ValidateIssuerSigningKey = true,
    ValidateLifetime = true,
    ValidIssuer = builder.Configuration["Jwt:Issuer"],
    ValidAudience = builder.Configuration["Jwt:Audience"],
    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]!)),
    ClockSkew = TimeSpan.FromSeconds(30)
});
builder.Services.AddAuthorization();
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<IStore, EfStore>();
builder.Services.AddScoped<ICurrentActor, CurrentActor>();
builder.Services.AddScoped<AccessService>();
builder.Services.AddScoped<Operations>();
builder.Services.AddScoped<AuthenticationService>();
builder.Services.AddScoped<IAllocationPolicy, ConstraintAllocationPolicy>();
builder.Services.AddHttpClient<IAiProvider, AiProvider>(c => c.Timeout = TimeSpan.FromSeconds(20));
builder.Services.AddHttpClient<EmailProvider>(c => c.Timeout = TimeSpan.FromSeconds(15));
builder.Services.AddScoped<IEmailProvider>(sp => EmailProviderFactory.Create(sp.GetRequiredService<IConfiguration>(), sp.GetRequiredService<EmailProvider>()));
builder.Services.AddHttpClient<IMappingProvider, MappingProvider>(c => c.Timeout = TimeSpan.FromSeconds(12));
builder.Services.AddHostedService<NotificationWorker>();
builder.Services.AddMemoryCache();
builder.Services.AddControllers().AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter(null, false)));
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? ["http://localhost:5173", "http://127.0.0.1:5173", "https://localhost:5173"];
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "local", _ => new FixedWindowRateLimiterOptions { PermitLimit = 240, Window = TimeSpan.FromMinutes(1) }));
    o.AddFixedWindowLimiter("auth", x => { x.PermitLimit = builder.Configuration.GetValue("RateLimits:AuthPermitLimit", 20); x.Window = TimeSpan.FromMinutes(1); });
    o.AddFixedWindowLimiter("maps", x => { x.PermitLimit = 30; x.Window = TimeSpan.FromMinutes(1); });
});
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 5 * 1024 * 1024);
var app = builder.Build();
if (args.Contains("--migrate"))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
    await db.Database.MigrateAsync();
    if (app.Environment.IsDevelopment())
        await SeedData.Initialise(db, scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>(), scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>(), app.Configuration);
    Console.WriteLine("Database migrations and development seed completed.");
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
        app.Logger.LogWarning("Request failed: {FailureType}, status {Status}, trace {TraceId}", ex.GetType().Name, status, context.TraceIdentifier);
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
public partial class Program;
