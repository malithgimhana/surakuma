using System.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Infrastructure;

public sealed class AppUser : IdentityUser
{
    public string DisplayName { get; set; } = ""; public string Language { get; set; } = "en";
}
public sealed class RefreshSession : Record
{
    public string UserId { get; set; } = ""; public string TokenHash { get; set; } = ""; public DateTimeOffset ExpiresAt
    {
        get; set;
    }
    public bool Revoked
    {
        get; set;
    }
}
public sealed class CrisisDbContext(DbContextOptions<CrisisDbContext> options) : IdentityDbContext<AppUser>(options)
{
    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);
        var types = typeof(AssistanceRequest).Assembly.GetTypes().Where(t => !t.IsAbstract && typeof(Record).IsAssignableFrom(t)).Append(typeof(RefreshSession));
        foreach (var type in types)
        {
            var e = b.Entity(type);
            e.HasKey(nameof(Record.Id));
            e.Property(nameof(Record.Version)).IsRowVersion();
            foreach (var p in type.GetProperties())
            {
                if (p.SetMethod is null)
                    continue;
                if (p.PropertyType == typeof(string))
                    e.Property(p.Name).HasMaxLength(p.Name.EndsWith("UserId") || p.Name is "CitizenId" or "ActorId" or "ApprovedBy" or "RecipientId" ? 450 : 4000);
                if (p.PropertyType == typeof(decimal))
                    e.Property(p.Name).HasPrecision(18, 2);
                if (p.PropertyType.IsEnum)
                    e.Property(p.Name).HasConversion<string>().HasMaxLength(50);
            }
        }
        b.Entity<Resource>().Ignore(x => x.Available);
        b.Entity<Shelter>().Ignore(x => x.Available);
        b.Entity<AssistanceRequest>().Property(x => x.SubmissionKey).HasMaxLength(100);
        b.Entity<AssistanceRequest>().Property(x => x.CitizenId).HasMaxLength(450);
        b.Entity<AssistanceRequest>().Property(x => x.Reference).HasMaxLength(30);
        b.Entity<AssistanceRequest>().HasIndex(x => new { x.CitizenId, x.SubmissionKey }).IsUnique();
        b.Entity<AssistanceRequest>().HasIndex(x => x.Reference).IsUnique();
        b.Entity<AssistanceRequest>().HasIndex(x => new { x.CrisisId, x.Status, x.Priority });
        b.Entity<Membership>().Property(x => x.UserId).HasMaxLength(450);
        b.Entity<Membership>().Property(x => x.Role).HasMaxLength(50);
        b.Entity<Membership>().HasIndex(x => new { x.UserId, x.OrganisationId, x.Role }).IsUnique();
        b.Entity<RefreshSession>().Property(x => x.TokenHash).HasMaxLength(64);
        b.Entity<RefreshSession>().HasIndex(x => x.TokenHash).IsUnique();
        b.Entity<CaseShare>().HasIndex(x => new { x.RequestId, x.OrganisationId }).IsUnique();
        b.Entity<CrisisAssignment>().Property(x => x.UserId).HasMaxLength(450);
        b.Entity<CrisisAssignment>().HasIndex(x => new { x.CrisisId, x.UserId }).IsUnique();
        b.Entity<Household>().Property(x => x.UserId).HasMaxLength(450);
        b.Entity<Household>().HasIndex(x => x.UserId).IsUnique();
        b.Entity<VolunteerProfile>().Property(x => x.UserId).HasMaxLength(450);
        b.Entity<VolunteerProfile>().HasIndex(x => x.UserId).IsUnique();
        b.Entity<Notification>().Property(x => x.UserId).HasMaxLength(450);
        b.Entity<Notification>().HasIndex(x => new { x.EventId, x.UserId }).IsUnique();
        b.Entity<NotificationDelivery>().Property(x => x.RecipientId).HasMaxLength(450);
        b.Entity<NotificationDelivery>().HasIndex(x => new { x.EventId, x.RecipientId }).IsUnique();
        b.Entity<PotentialDuplicate>().HasIndex(x => new { x.RequestId, x.CandidateId }).IsUnique();
        b.Entity<OutboxMessage>().HasIndex(x => new { x.State, x.NextAttemptAt });
        b.Entity<Resource>().ToTable(t => t.HasCheckConstraint("CK_Resource_Stock", "[Stock] >= 0 AND [Reserved] >= 0 AND [Reserved] <= [Stock]"));
        b.Entity<Shelter>().ToTable(t => t.HasCheckConstraint("CK_Shelter_Capacity", "[Capacity] >= 1 AND [Reserved] >= 0 AND [Occupancy] >= 0 AND [Reserved] + [Occupancy] <= [Capacity]"));
        b.Entity<AssistanceRequest>().ToTable(t => t.HasCheckConstraint("CK_Request_Quantity", "[Quantity] > 0 AND [DeliveredQuantity] >= 0 AND [DeliveredQuantity] <= [Quantity] AND [HouseholdSize] >= 1"));
        // Explicit relationships preserve referential integrity without cascading operational history.
        Fk<Membership, Organisation>(b, nameof(Membership.OrganisationId));
        Fk<Membership, AppUser>(b, nameof(Membership.UserId));
        Fk<Household, AppUser>(b, nameof(Household.UserId));
        Fk<RefreshSession, AppUser>(b, nameof(RefreshSession.UserId));
        Fk<CrisisAssignment, Crisis>(b, nameof(CrisisAssignment.CrisisId));
        Fk<CrisisAssignment, AppUser>(b, nameof(CrisisAssignment.UserId));
        Fk<OperationalArea, Crisis>(b, nameof(OperationalArea.CrisisId));
        Fk<AssistanceRequest, AppUser>(b, nameof(AssistanceRequest.CitizenId));
        Fk<AssistanceRequest, Crisis>(b, nameof(AssistanceRequest.CrisisId));
        Fk<AssistanceRequest, Organisation>(b, nameof(AssistanceRequest.OrganisationId));
        Fk<CaseShare, AssistanceRequest>(b, nameof(CaseShare.RequestId));
        Fk<CaseShare, Organisation>(b, nameof(CaseShare.OrganisationId));
        Fk<RequestHistory, AssistanceRequest>(b, nameof(RequestHistory.RequestId));
        Fk<Attachment, AssistanceRequest>(b, nameof(Attachment.RequestId));
        Fk<Recommendation, AssistanceRequest>(b, nameof(Recommendation.RequestId));
        Fk<HumanDecision, Recommendation>(b, nameof(HumanDecision.RecommendationId));
        Fk<HumanDecision, AssistanceRequest>(b, nameof(HumanDecision.RequestId));
        Fk<PotentialDuplicate, AssistanceRequest>(b, nameof(PotentialDuplicate.RequestId));
        Fk<PotentialDuplicate, AssistanceRequest>(b, nameof(PotentialDuplicate.CandidateId));
        Fk<Resource, Organisation>(b, nameof(Resource.OrganisationId));
        Fk<StockMovement, Resource>(b, nameof(StockMovement.ResourceId));
        Fk<ResourceAllocation, Resource>(b, nameof(ResourceAllocation.ResourceId));
        Fk<ResourceAllocation, AssistanceRequest>(b, nameof(ResourceAllocation.RequestId));
        Fk<Shelter, Organisation>(b, nameof(Shelter.OrganisationId));
        Fk<ShelterAllocation, Shelter>(b, nameof(ShelterAllocation.ShelterId));
        Fk<ShelterAllocation, AssistanceRequest>(b, nameof(ShelterAllocation.RequestId));
        Fk<VolunteerProfile, AppUser>(b, nameof(VolunteerProfile.UserId));
        Fk<VolunteerProfile, Organisation>(b, nameof(VolunteerProfile.OrganisationId));
        Fk<VolunteerTask, VolunteerProfile>(b, nameof(VolunteerTask.VolunteerId));
        Fk<VolunteerTask, AssistanceRequest>(b, nameof(VolunteerTask.RequestId));
        Fk<PublicAlert, Crisis>(b, nameof(PublicAlert.CrisisId));
        Fk<Notification, AppUser>(b, nameof(Notification.UserId));
        Fk<Feedback, AssistanceRequest>(b, nameof(Feedback.RequestId));
        Fk<Feedback, AppUser>(b, nameof(Feedback.UserId));
    }
    private static void Fk<T, TParent>(ModelBuilder b, string field) where T : class where TParent : class => b.Entity<T>().HasOne<TParent>().WithMany().HasForeignKey(field).OnDelete(DeleteBehavior.Restrict);
    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        foreach (var entry in ChangeTracker.Entries<Record>().Where(x => x.State == EntityState.Modified))
            entry.Entity.UpdatedAt = DateTimeOffset.UtcNow;
        return base.SaveChangesAsync(ct);
    }
}
public sealed class EfStore(CrisisDbContext db) : IStore
{
    public IQueryable<T> Query<T>() where T : Record => db.Set<T>();
    public Task<List<T>> ListAsync<T>(IQueryable<T> query, CancellationToken ct = default) => query.ToListAsync(ct);
    public async Task<T?> FindAsync<T>(Guid id, CancellationToken ct = default) where T : Record => await db.Set<T>().FindAsync([id], ct);
    public void Add<T>(T entity) where T : Record => db.Add(entity);
    public async Task SaveAsync(CancellationToken ct = default) => await db.SaveChangesAsync(ct);
    public async Task<T> TransactionAsync<T>(Func<Task<T>> operation, CancellationToken ct = default)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var result = await operation();
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return result;
    }
}
public sealed class CurrentActor(IHttpContextAccessor context) : ICurrentActor
{
    public string Id => context.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw new AccessDeniedException();
}
