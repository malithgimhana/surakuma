using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Surakuma.Infrastructure;

// A local-only maintenance tool for the eight seeded demonstration users.
string[] accounts = ["citizen", "coordinator", "case", "logistics", "shelter", "volunteers", "volunteer", "admin"];
if (args.Length != 1)
{
    Console.Error.WriteLine("Usage: dotnet run --project backend/tools/DemoPasswordReset -- <path-to-local-demo-logins.md>");
    return 1;
}

try
{
    var passwords = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    foreach (string line in File.ReadLines(args[0]))
    {
        var parts = line.Split('|');
        if (parts.Length < 4) continue;
        string email = parts[1].Trim(), password = parts[2].Trim().Trim('`');
        if (!accounts.Any(x => email.Equals(x + "@surakuma.test", StringComparison.OrdinalIgnoreCase))) continue;
        if (!passwords.TryAdd(email, password)) throw new InvalidOperationException($"Duplicate account in credential file: {email}");
    }
    if (passwords.Count != accounts.Length) throw new InvalidOperationException("The file must list each of the eight demo accounts exactly once.");

    var validator = new PasswordValidator<AppUser>();
    var options = Microsoft.Extensions.Options.Options.Create(new IdentityOptions { Password = new PasswordOptions { RequiredLength = 10 } });
    // The default Identity password policy requires upper/lowercase, digits and a symbol.
    using var manager = new UserManager<AppUser>(new ValidationOnlyStore(), options, new PasswordHasher<AppUser>(), [], [validator], new UpperInvariantLookupNormalizer(), new IdentityErrorDescriber(), null!, Microsoft.Extensions.Logging.Abstractions.NullLogger<UserManager<AppUser>>.Instance);
    foreach (var pair in passwords)
    {
        var result = await validator.ValidateAsync(manager, new AppUser(), pair.Value);
        if (!result.Succeeded) throw new InvalidOperationException($"Invalid password for {pair.Key}: {string.Join("; ", result.Errors.Select(x => x.Description))}");
    }
    if (passwords.Values.Distinct(StringComparer.Ordinal).Count() != accounts.Length) throw new InvalidOperationException("Give every demo account a different password.");

    // Limit this tool to local development databases, never an arbitrary connection string.
    string server = Environment.GetEnvironmentVariable("SURAKUMA_DEMO_SQL_SERVER") ?? @"(localdb)\MSSQLLocalDB";
    if (!server.Equals(@"(localdb)\MSSQLLocalDB", StringComparison.OrdinalIgnoreCase) && !server.Equals(@".\SQLEXPRESS", StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("Only (localdb)\\MSSQLLocalDB and .\\SQLEXPRESS are supported.");
    var connectionString = new SqlConnectionStringBuilder { DataSource = server, InitialCatalog = "Surakuma", IntegratedSecurity = true, TrustServerCertificate = true, ConnectTimeout = 10 }.ConnectionString;
    Console.WriteLine($"Updating all eight demo accounts in Surakuma on {server}. Existing refresh sessions will be revoked.");
    Console.Write("Type RESET to continue: ");
    if (Console.ReadLine() != "RESET") { Console.WriteLine("Cancelled."); return 1; }

    await using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync();
    var hasher = new PasswordHasher<AppUser>();
    foreach (var pair in passwords)
    {
        await using var command = new SqlCommand("UPDATE AspNetUsers SET PasswordHash=@hash, SecurityStamp=@stamp, ConcurrencyStamp=@concurrency, AccessFailedCount=0, LockoutEnd=NULL WHERE NormalizedEmail=@email; SELECT @@ROWCOUNT;", connection, transaction);
        command.Parameters.AddWithValue("@hash", hasher.HashPassword(new AppUser(), pair.Value));
        command.Parameters.AddWithValue("@stamp", Guid.NewGuid().ToString());
        command.Parameters.AddWithValue("@concurrency", Guid.NewGuid().ToString());
        command.Parameters.AddWithValue("@email", pair.Key.ToUpperInvariant());
        if (Convert.ToInt32(await command.ExecuteScalarAsync()) != 1) throw new InvalidOperationException($"Expected exactly one account for {pair.Key}; no changes saved.");
        await using var revoke = new SqlCommand("UPDATE RefreshSession SET Revoked=1 WHERE UserId=(SELECT Id FROM AspNetUsers WHERE NormalizedEmail=@email) AND Revoked=0", connection, transaction);
        revoke.Parameters.AddWithValue("@email", pair.Key.ToUpperInvariant());
        await revoke.ExecuteNonQueryAsync();
    }
    await transaction.CommitAsync();
    Console.WriteLine("Updated all eight demo passwords.");
    return 0;
}
catch (Exception ex)
{
    Console.Error.WriteLine($"Password reset failed: {ex.Message}");
    return 1;
}

// Password validation requires a UserManager, but does not need a database-backed store.
sealed class ValidationOnlyStore : IUserStore<AppUser>
{
    public void Dispose() { }
    public Task<string> GetUserIdAsync(AppUser user, CancellationToken cancellationToken) => throw new NotSupportedException();
    public Task<string?> GetUserNameAsync(AppUser user, CancellationToken cancellationToken) => throw new NotSupportedException();
    public Task SetUserNameAsync(AppUser user, string? userName, CancellationToken cancellationToken) => throw new NotSupportedException();
    public Task<string?> GetNormalizedUserNameAsync(AppUser user, CancellationToken cancellationToken) => throw new NotSupportedException();
    public Task SetNormalizedUserNameAsync(AppUser user, string? normalizedName, CancellationToken cancellationToken) => throw new NotSupportedException();
    public Task<IdentityResult> CreateAsync(AppUser user, CancellationToken cancellationToken) => throw new NotSupportedException();
    public Task<IdentityResult> UpdateAsync(AppUser user, CancellationToken cancellationToken) => throw new NotSupportedException();
    public Task<IdentityResult> DeleteAsync(AppUser user, CancellationToken cancellationToken) => throw new NotSupportedException();
    public Task<AppUser?> FindByIdAsync(string userId, CancellationToken cancellationToken) => throw new NotSupportedException();
    public Task<AppUser?> FindByNameAsync(string normalizedUserName, CancellationToken cancellationToken) => throw new NotSupportedException();
}
