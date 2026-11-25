using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;
using Record = Surakuma.Domain.Record;

namespace Surakuma.Tests;

public sealed class QueryOrderingTests
{
    [Theory]
    [InlineData(Roles.CaseManager)]
    [InlineData(Roles.Coordinator)]
    public async Task StaffAccessQueriesCompileWithoutUnorderedRowLimits(string role)
    {
        // Compile real SQL Server queries without opening a database connection.
        using var db = new CrisisDbContext(new DbContextOptionsBuilder<CrisisDbContext>()
            .UseSqlServer("Server=localhost;Database=QueryCompilationOnly;Trusted_Connection=True;TrustServerCertificate=True")
            .ConfigureWarnings(w => w.Throw(CoreEventId.RowLimitingOperationWithoutOrderByWarning)).Options);
        var store = new CompilationStore(db);
        var access = new AccessService(store, new Actor());

        var cases = await access.StaffCases(role, default);
        _ = cases.ToQueryString();

        Assert.Equal(role == Roles.CaseManager ? 2 : 1, store.CompiledQueries.Count);
        Assert.All(store.CompiledQueries, sql => Assert.Contains("ORDER BY", sql));
    }

    private sealed class Actor : ICurrentActor
    {
        public string Id => "staff";
        public string? SelectedCountry => "LK";
    }

    private sealed class CompilationStore(CrisisDbContext db) : IStore
    {
        public List<string> CompiledQueries { get; } = [];
        public IQueryable<string> ActiveSystemAdministratorIds => db.ActiveSystemAdministrators.Select(u => u.Id);
        public IQueryable<T> Query<T>() where T : Record => db.Set<T>();
        public Task<List<T>> ListAsync<T>(IQueryable<T> query, CancellationToken ct = default)
        {
            CompiledQueries.Add(query.ToQueryString());
            // Supply access grants so the service proceeds through both prechecks.
            if (typeof(T) == typeof(string)) return Task.FromResult((List<T>)(object)new List<string> { "LK" });
            if (typeof(T) == typeof(Guid)) return Task.FromResult((List<T>)(object)new List<Guid> { Guid.NewGuid() });
            throw new NotSupportedException();
        }
        public Task<T?> FindAsync<T>(Guid id, CancellationToken ct = default) where T : Record => throw new NotSupportedException();
        public void Add<T>(T entity) where T : Record => throw new NotSupportedException();
        public void Remove<T>(T entity) where T : Record => throw new NotSupportedException();
        public Task SaveAsync(CancellationToken ct = default) => throw new NotSupportedException();
        public Task<T> TransactionAsync<T>(Func<Task<T>> operation, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<T> RoutingTransactionAsync<T>(Func<Task<T>> operation, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<T> FeedbackTransactionAsync<T>(Guid requestId, Func<Task<T>> operation, CancellationToken ct = default) => throw new NotSupportedException();
    }
}
