using System.Data;
using System.Globalization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;
using System.Security.Claims;
using Surakuma.Application;
using Surakuma.Domain;
using StaffRoles = Surakuma.Domain.Roles;

namespace Surakuma.Infrastructure;

public sealed class AppUser : IdentityUser
{
    public bool Disabled { get; set; }
    public bool IsSystemAdministrator { get; set; }
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
    public IQueryable<AppUser> ActiveSystemAdministrators => Users.Where(u => u.IsSystemAdministrator && !u.Disabled);

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
        ConfigurePublicReferences(b);
        b.Entity<SecurityEmail>().Property(e => e.ProtectedToken).HasMaxLength(-1);
        b.Entity<Membership>().HasQueryFilter(m => !m.Suspended && m.Role != StaffRoles.Administrator
            && Users.Any(u => u.Id == m.UserId && !u.Disabled)
            && (m.Role == StaffRoles.CountryAdministrator || !Set<OrganisationCountry>().IgnoreQueryFilters().Any(link =>
                link.OrganisationId == m.OrganisationId && link.CountryCode == m.CountryCode && link.ArchivedAt != null))
            && (m.Role == StaffRoles.CountryAdministrator || Set<Organisation>().Any(o => o.Id == m.OrganisationId && o.ArchivedAt == null)));
        b.Entity<OrganisationCountry>().HasQueryFilter(link => link.ArchivedAt == null &&
            Set<Organisation>().Any(o => o.Id == link.OrganisationId && o.ArchivedAt == null));
        b.Entity<AuditEvent>().Property(x => x.CountryCode).HasMaxLength(2).IsUnicode(false);
        b.Entity<AuditEvent>().HasIndex(x => new { x.CountryCode, x.CreatedAt, x.Id });
        b.Entity<AdminAlert>().Property(x => x.ConditionKey).HasMaxLength(180);
        b.Entity<AdminAlert>().HasIndex(x => x.ConditionKey).IsUnique().HasFilter("[ResolvedAt] IS NULL");
        b.Entity<Resource>().Ignore(x => x.Available);
        b.Entity<Country>().Property(x => x.Code).HasMaxLength(2).IsUnicode(false);
        b.Entity<Country>().HasAlternateKey(x => x.Code);
        b.Entity<Depot>().Property(x => x.CountryCode).HasMaxLength(2).IsUnicode(false);
        b.Entity<Depot>().Property(x => x.Name).HasMaxLength(120);
        b.Entity<Depot>().HasIndex(x => new { x.CountryCode, x.OrganisationId, x.Name }).IsUnique();
        b.Entity<Depot>().HasOne<Country>().WithMany().HasForeignKey(x => x.CountryCode).HasPrincipalKey(x => x.Code).OnDelete(DeleteBehavior.Restrict);
        Fk<Depot, Organisation>(b, nameof(Depot.OrganisationId));
        Fk<Resource, Depot>(b, nameof(Resource.DepotId));
        Fk<Membership, Depot>(b, nameof(Membership.DepotId));
        Fk<CaseNeed, AssistanceRequest>(b, nameof(CaseNeed.RequestId));
        b.Entity<CaseNeed>().Property(n => n.DeliveredQuantity).HasPrecision(18, 5);
        Fk<ResourceAllocation, CaseNeed>(b, nameof(ResourceAllocation.NeedId));
        Fk<AssistanceRequest, Depot>(b, nameof(AssistanceRequest.HandoverCentreId));
        Fk<CaseDispatch, Depot>(b, nameof(CaseDispatch.CentreId));
        Fk<CaseDispatch, AssistanceRequest>(b, nameof(CaseDispatch.RequestId));
        Fk<ResourceAllocation, CaseDispatch>(b, nameof(ResourceAllocation.CaseDispatchId));
        Fk<VolunteerTask, CaseDispatch>(b, nameof(VolunteerTask.CaseDispatchId));
        b.Entity<ResourceAllocation>().Property(x => x.CentreReceivedQuantity).HasPrecision(18, 2);
        b.Entity<ResourceAllocation>().Property(x => x.CitizenReceivedQuantity).HasPrecision(18, 2);
        b.Entity<VolunteerTaskEvent>().Property(x => x.HandoverQuantitiesJson).HasMaxLength(-1);
        b.Entity<CaseNeed>().ToTable(t => t.HasCheckConstraint("CK_CaseNeed_Quantities",
            "[RequiredQuantity] > 0 AND [ApprovedQuantity] > 0 AND [DeliveredQuantity] >= 0 AND [DeliveredQuantity] <= [ApprovedQuantity]"));
        b.Entity<LogisticsPreferences>().HasIndex(p => p.UserId).IsUnique();
        b.Entity<LogisticsPreferences>().HasOne<AppUser>().WithMany().HasForeignKey(p => p.UserId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Resource>().Property(x => x.Code).HasMaxLength(40);
        b.Entity<Resource>().Property(x => x.LowStockThreshold).HasPrecision(18, 2);
        b.Entity<Resource>().HasIndex(x => x.CountryCode);
        b.Entity<Resource>().HasIndex(x => new { x.CountryCode, x.DepotId, x.Code }).IsUnique()
            .HasFilter("[Code] IS NOT NULL");
        Fk<LogisticsOrder, Resource>(b, nameof(LogisticsOrder.ResourceId));
        Fk<LogisticsOrder, Resource>(b, nameof(LogisticsOrder.DestinationResourceId));
        Fk<LogisticsOrder, Crisis>(b, nameof(LogisticsOrder.CrisisId));
        Fk<LogisticsOrder, OperationalArea>(b, nameof(LogisticsOrder.OperationalAreaId));
        b.Entity<LogisticsOrder>().ToTable(t => t.HasCheckConstraint("CK_LogisticsOrder_Quantity", "[Quantity] > 0"));
        Fk<DeliveryConfirmation, ResourceAllocation>(b, nameof(DeliveryConfirmation.AllocationId));
        Fk<DeliveryConfirmation, LogisticsOrder>(b, nameof(DeliveryConfirmation.LogisticsOrderId));
        b.Entity<DeliveryConfirmation>().HasIndex(x => x.AllocationId).IsUnique();
        b.Entity<DeliveryConfirmation>().HasIndex(x => x.LogisticsOrderId).IsUnique();
        b.Entity<DeliveryConfirmation>().ToTable(t => t.HasCheckConstraint("CK_DeliveryConfirmation_Shipment",
            "(([AllocationId] IS NOT NULL AND [LogisticsOrderId] IS NULL) OR ([AllocationId] IS NULL AND [LogisticsOrderId] IS NOT NULL)) AND [ConfirmedQuantity] >= 0"));
        b.Entity<StockMovement>().HasIndex(x => x.OperationId);
        foreach (var entity in new[] { typeof(Crisis), typeof(Resource), typeof(Shelter), typeof(AdministrativeDivision), typeof(OrganisationCountry), typeof(Membership), typeof(VolunteerProfile) })
            b.Entity(entity).Property<string>("CountryCode").HasMaxLength(2).IsUnicode(false).HasDefaultValue("LK");
        b.Entity<OrganisationCountry>().HasIndex(x => new { x.OrganisationId, x.CountryCode }).IsUnique();
        b.Entity<AdministrativeDivision>().HasOne<AdministrativeDivision>().WithMany().HasForeignKey(x => new { x.ParentId, x.CountryCode }).HasPrincipalKey(x => new { x.Id, x.CountryCode }).OnDelete(DeleteBehavior.Restrict);
        b.Entity<AdministrativeDivision>().HasOne<Country>().WithMany().HasForeignKey(x => x.CountryCode).HasPrincipalKey(x => x.Code).OnDelete(DeleteBehavior.Restrict);
        b.Entity<OrganisationCountry>().HasOne<Country>().WithMany().HasForeignKey(x => x.CountryCode).HasPrincipalKey(x => x.Code).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Crisis>().HasOne<Country>().WithMany().HasForeignKey(x => x.CountryCode).HasPrincipalKey(x => x.Code).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Resource>().HasOne<Country>().WithMany().HasForeignKey(x => x.CountryCode).HasPrincipalKey(x => x.Code).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Shelter>().HasOne<Country>().WithMany().HasForeignKey(x => x.CountryCode).HasPrincipalKey(x => x.Code).OnDelete(DeleteBehavior.Restrict);
        Fk<OrganisationCountry, Organisation>(b, nameof(OrganisationCountry.OrganisationId));
        b.Entity<AdministrativeDivision>().HasAlternateKey(x => new { x.Id, x.CountryCode });
        b.Entity<Crisis>().HasAlternateKey(x => new { x.Id, x.CountryCode });
        b.Entity<Crisis>().HasOne<AdministrativeDivision>().WithMany().HasForeignKey(x => new { x.AdministrativeDivisionId, x.CountryCode }).HasPrincipalKey(x => new { x.Id, x.CountryCode }).OnDelete(DeleteBehavior.Restrict);
        Fk<Crisis, InternationalIncident>(b, nameof(Crisis.InternationalIncidentId));
        b.Entity<Resource>().HasOne<AdministrativeDivision>().WithMany().HasForeignKey(x => new { x.AdministrativeDivisionId, x.CountryCode }).HasPrincipalKey(x => new { x.Id, x.CountryCode }).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Shelter>().HasOne<AdministrativeDivision>().WithMany().HasForeignKey(x => new { x.AdministrativeDivisionId, x.CountryCode }).HasPrincipalKey(x => new { x.Id, x.CountryCode }).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Membership>().HasOne<Country>().WithMany().HasForeignKey(x => x.CountryCode).HasPrincipalKey(x => x.Code).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Membership>().HasOne<Crisis>().WithMany().HasForeignKey(x => new { x.CrisisId, x.CountryCode }).HasPrincipalKey(x => new { x.Id, x.CountryCode }).OnDelete(DeleteBehavior.Restrict);
        b.Entity<VolunteerProfile>().HasOne<Country>().WithMany().HasForeignKey(x => x.CountryCode).HasPrincipalKey(x => x.Code).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Shelter>().Ignore(x => x.Available);
        b.Entity<AssistanceRequest>().Property(x => x.SubmissionKey).HasMaxLength(100);
        b.Entity<AssistanceRequest>().Property(x => x.CitizenId).HasMaxLength(450);
        b.Entity<AssistanceRequest>().Property(x => x.AssignedCaseManagerId).HasMaxLength(450);
        b.Entity<AssistanceRequest>().Property(x => x.Unit).HasMaxLength(32);
        b.Entity<AssistanceRequest>().Property(x => x.DeliveredQuantity).HasPrecision(21, 5);
        b.Entity<AssistanceRequest>().Property(x => x.IntakeScore).HasPrecision(4, 1);
        b.Entity<AssistanceRequest>().Property(x => x.PriorityScore).HasPrecision(4, 1);
        b.Entity<AssistanceRequest>().Property(x => x.AssessmentState).HasMaxLength(20);
        b.Entity<AssistanceRequest>().HasIndex(x => x.NextPriorityEscalationAt).HasFilter("[NextPriorityEscalationAt] IS NOT NULL");
        b.Entity<ResourceAllocation>().Property(x => x.RequestQuantity).HasPrecision(21, 5);
        b.Entity<AssistanceRequest>().HasIndex(x => new { x.CitizenId, x.SubmissionKey }).IsUnique();
        b.Entity<AssistanceRequest>().HasIndex(x => new { x.CrisisId, x.Status, x.Priority });
        b.Entity<Membership>().Property(x => x.UserId).HasMaxLength(450);
        b.Entity<Membership>().Property(x => x.Role).HasMaxLength(50);
        b.Entity<Membership>().HasIndex(x => new { x.UserId, x.OrganisationId, x.Role, x.CountryCode, x.CrisisId }).IsUnique().HasFilter(null);
        b.Entity<RefreshSession>().Property(x => x.TokenHash).HasMaxLength(64);
        b.Entity<RefreshSession>().HasIndex(x => x.TokenHash).IsUnique();
        b.Entity<CaseShare>().HasIndex(x => new { x.RequestId, x.OrganisationId }).IsUnique();
        b.Entity<CaseShare>().Property(x => x.WorkTitle).HasMaxLength(160);
        b.Entity<CaseShare>().Property(x => x.WorkInstructions).HasMaxLength(1000);
        b.Entity<CrisisAssignment>().Property(x => x.UserId).HasMaxLength(450);
        b.Entity<CrisisAssignment>().HasIndex(x => new { x.CrisisId, x.UserId }).IsUnique();
        b.Entity<Household>().Property(x => x.UserId).HasMaxLength(450);
        b.Entity<Household>().HasIndex(x => x.UserId).IsUnique();
        b.Entity<VolunteerProfile>().Property(x => x.UserId).HasMaxLength(450);
        b.Entity<VolunteerProfile>().HasIndex(x => x.UserId).IsUnique();
        Fk<VolunteerProfile, AssistanceRequest>(b, nameof(VolunteerProfile.TaskRequestId));
        Fk<VolunteerProfile, CaseDispatch>(b, nameof(VolunteerProfile.TaskDispatchId));
        b.Entity<Notification>().Property(x => x.UserId).HasMaxLength(450);
        b.Entity<Notification>().HasIndex(x => new { x.EventId, x.UserId }).IsUnique();
        b.Entity<Notification>().HasIndex(x => new { x.UserId, x.CreatedAt });
        b.Entity<AssistanceCentre>().HasIndex(x => new { x.CountryCode, x.Published });
        b.Entity<VolunteerAvailabilityWindow>().HasIndex(x => new { x.UserId, x.StartsAt });
        b.Entity<BrowserPushSubscription>().Property(x => x.EndpointHash).HasMaxLength(64);
        b.Entity<BrowserPushSubscription>().HasIndex(x => x.EndpointHash).IsUnique();
        b.Entity<BrowserPushSubscription>().HasIndex(x => x.UserId);
        b.Entity<BrowserPushDelivery>().HasIndex(x => new { x.SubscriptionId, x.NotificationId }).IsUnique();
        b.Entity<BrowserPushDelivery>().HasOne<BrowserPushSubscription>().WithMany().HasForeignKey(x => x.SubscriptionId);
        b.Entity<BrowserPushDelivery>().HasOne<Notification>().WithMany().HasForeignKey(x => x.NotificationId);
        b.Entity<Notification>().Property(x => x.ScopeCountryCode).HasMaxLength(2).IsUnicode(false);
        b.Entity<Notification>().Property(x => x.ScopeRole).HasMaxLength(50);
        b.Entity<PartnerContribution>().Property(x => x.CountryCode).HasMaxLength(2).IsUnicode(false);
        b.Entity<PartnerContribution>().HasIndex(x => new { x.CountryCode, x.OrganisationId, x.Status });
        b.Entity<PartnerContribution>().HasOne<Country>().WithMany().HasForeignKey(x => x.CountryCode)
            .HasPrincipalKey(x => x.Code).OnDelete(DeleteBehavior.Restrict);
        Fk<PartnerContribution, Organisation>(b, nameof(PartnerContribution.OrganisationId));
        b.Entity<PartnerContribution>().ToTable(t => t.HasCheckConstraint("CK_PartnerContribution_Quantity",
            "[Quantity] > 0 AND [FulfilledQuantity] >= 0 AND [FulfilledQuantity] <= [Quantity]"));
        b.Entity<NotificationDelivery>().Property(x => x.RecipientId).HasMaxLength(450);
        b.Entity<NotificationDelivery>().HasIndex(x => new { x.EventId, x.RecipientId }).IsUnique();
        b.Entity<PotentialDuplicate>().HasIndex(x => new { x.RequestId, x.CandidateId }).IsUnique();
        b.Entity<RequestAnalysisJob>().Property(x => x.State).HasMaxLength(32);
        b.Entity<RequestAnalysisJob>().HasIndex(x => x.RequestId).IsUnique();
        b.Entity<RequestAnalysisJob>().HasIndex(x => new { x.State, x.AvailableAt });
        b.Entity<RequestEmbedding>().HasIndex(x => x.RequestId).IsUnique();
        b.Entity<RequestEmbedding>().Property(x => x.Vector).HasMaxLength(1024);
        b.Entity<AiInvocation>().Property(x => x.EstimatedUsd).HasPrecision(18, 8);
        b.Entity<CaseMessageDraft>().HasIndex(x => new { x.RequestId, x.CreatedAt });
        Fk<CaseMessageDraft, AssistanceRequest>(b, nameof(CaseMessageDraft.RequestId));
        Fk<RequestAnalysisJob, AssistanceRequest>(b, nameof(RequestAnalysisJob.RequestId));
        Fk<RequestEmbedding, AssistanceRequest>(b, nameof(RequestEmbedding.RequestId));
        Fk<VolunteerProfile, AdministrativeDivision>(b, nameof(VolunteerProfile.ServiceRegionId));
        b.Entity<OutboxMessage>().HasIndex(x => new { x.State, x.NextAttemptAt });
        b.Entity<OutboxMessage>().Property(x => x.FundingCountryCode).HasMaxLength(2).IsUnicode(false);
        b.Entity<OutboxMessage>().HasOne<Country>().WithMany().HasForeignKey(x => x.FundingCountryCode)
            .HasPrincipalKey(x => x.Code).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Resource>().ToTable(t => t.HasCheckConstraint("CK_Resource_Stock", "[Stock] >= 0 AND [Reserved] >= 0 AND [Reserved] <= [Stock]"));
        b.Entity<Shelter>().ToTable(t => t.HasCheckConstraint("CK_Shelter_Capacity", "[Capacity] >= 1 AND [Reserved] >= 0 AND [Occupancy] >= 0 AND [Reserved] + [Occupancy] <= [Capacity]"));
        b.Entity<AssistanceRequest>().ToTable(t => t.HasCheckConstraint("CK_Request_Quantity", "[Quantity] > 0 AND [DeliveredQuantity] >= 0 AND [DeliveredQuantity] <= [Quantity] AND [HouseholdSize] >= 1"));
        // Explicit relationships preserve referential integrity without cascading operational history.
        Fk<Membership, Organisation>(b, nameof(Membership.OrganisationId));
        Fk<Membership, AppUser>(b, nameof(Membership.UserId));
        Fk<Household, AppUser>(b, nameof(Household.UserId));
        Fk<RefreshSession, AppUser>(b, nameof(RefreshSession.UserId));
        Fk<CrisisAssignment, Crisis>(b, nameof(CrisisAssignment.CrisisId));
        Fk<Crisis, Organisation>(b, nameof(Crisis.PrimaryOrganisationId));
        Fk<CrisisAssignment, AppUser>(b, nameof(CrisisAssignment.UserId));
        Fk<OperationalArea, Crisis>(b, nameof(OperationalArea.CrisisId));
        Fk<AssistanceRequest, AppUser>(b, nameof(AssistanceRequest.CitizenId));
        Fk<AssistanceRequest, AppUser>(b, nameof(AssistanceRequest.AssignedCaseManagerId));
        Fk<AssistanceRequest, Crisis>(b, nameof(AssistanceRequest.CrisisId));
        Fk<AssistanceRequest, AdministrativeDivision>(b, nameof(AssistanceRequest.AdministrativeDivisionId));
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
        b.Entity<VolunteerTask>().HasIndex(x => new { x.VolunteerId, x.Status, x.DueAt });
        b.Entity<VolunteerTask>().ToTable(t => t.HasCheckConstraint("CK_VolunteerTask_Window", "[StartsAt] IS NULL OR [StartsAt] < [DueAt]"));
        Fk<VolunteerTaskEvent, VolunteerTask>(b, nameof(VolunteerTaskEvent.TaskId));
        b.Entity<VolunteerTaskEvent>().HasIndex(x => new { x.TaskId, x.CreatedAt });
        Fk<PublicAlert, Crisis>(b, nameof(PublicAlert.CrisisId));
        b.Entity<PublicAlert>().Property(x => x.VisualSummary).HasMaxLength(360);
        b.Entity<PublicAlert>().Property(x => x.PopupDescription).HasMaxLength(480);
        b.Entity<PublicAlert>().Property(x => x.VisualKind).HasMaxLength(24);
        b.Entity<PublicAlert>().Property(x => x.VisualImageUrl).HasMaxLength(240);
        b.Entity<PublicAlertVisual>().HasIndex(x => x.AlertId).IsUnique();
        b.Entity<PublicAlertVisual>().HasIndex(x => new { x.Completed, x.AvailableAt });
        Fk<PublicAlertVisual, PublicAlert>(b, nameof(PublicAlertVisual.AlertId));
        Fk<Notification, AppUser>(b, nameof(Notification.UserId));
        Fk<Feedback, AssistanceRequest>(b, nameof(Feedback.RequestId));
        Fk<Feedback, AppUser>(b, nameof(Feedback.UserId));
        b.Entity<Feedback>().HasIndex(x => new { x.RequestId, x.UserId }).IsUnique().HasFilter("[IsSuperseded] = 0");
        ConfigureFunding(b);
        ConfigureDecisionSupport(b);
        ConfigureSupplySupport(b);
    }
    private static void ConfigureSupplySupport(ModelBuilder b)
    {
        b.Entity<SupplyRequest>().Property(x => x.CountryCode).HasMaxLength(2).IsUnicode(false);
        b.Entity<SupplyRequest>().HasOne<Country>().WithMany().HasForeignKey(x => x.CountryCode)
            .HasPrincipalKey(x => x.Code).OnDelete(DeleteBehavior.Restrict);
        Fk<SupplyRequest, Organisation>(b, nameof(SupplyRequest.RequestingOrganisationId));
        Fk<SupplyRequest, Organisation>(b, nameof(SupplyRequest.TargetOrganisationId));
        Fk<SupplyRequest, Shelter>(b, nameof(SupplyRequest.ShelterId));
        Fk<SupplyRequest, AssistanceRequest>(b, nameof(SupplyRequest.CaseId));
        Fk<SupplyRequest, Crisis>(b, nameof(SupplyRequest.CrisisId));
        Fk<SupplyRequest, Resource>(b, nameof(SupplyRequest.DestinationResourceId));
        b.Entity<SupplyRequest>().HasIndex(x => new { x.CountryCode, x.RequestingOrganisationId, x.CreatedAt });
        b.Entity<SupplyRequest>().HasIndex(x => new { x.CountryCode, x.TargetOrganisationId, x.CreatedAt });
        b.Entity<SupplyRequest>().ToTable(t => t.HasCheckConstraint("CK_SupplyRequest_Balance",
            "[Quantity] > 0 AND [ReceivedQuantity] BETWEEN 0 AND [Quantity] AND [RequestingOrganisationId] <> [TargetOrganisationId] AND ([ShelterId] IS NULL OR [CaseId] IS NULL)"));
        Fk<PartnerContribution, SupplyRequest>(b, nameof(PartnerContribution.SupportRequestId));
        b.Entity<PartnerContribution>().Property(x => x.Category).HasConversion<string>().HasMaxLength(50);
        Fk<PartnerStockReceipt, PartnerContribution>(b, nameof(PartnerStockReceipt.ContributionId));
        Fk<PartnerStockReceipt, StockMovement>(b, nameof(PartnerStockReceipt.StockMovementId));
        b.Entity<PartnerStockReceipt>().Property(x => x.Reference).HasMaxLength(100);
        b.Entity<PartnerStockReceipt>().HasIndex(x => x.StockMovementId).IsUnique();
        b.Entity<PartnerStockReceipt>().HasIndex(x => new { x.ContributionId, x.Reference }).IsUnique();
        b.Entity<PartnerStockReceipt>().ToTable(t => t.HasCheckConstraint("CK_PartnerStockReceipt_Quantity", "[Quantity] > 0"));
    }
    private static void ConfigureDecisionSupport(ModelBuilder b)
    {
        Fk<DemandForecast, Crisis>(b, nameof(DemandForecast.CrisisId));
        Fk<DemandForecast, AdministrativeDivision>(b, nameof(DemandForecast.RegionId));
        b.Entity<DemandForecast>().Property(x => x.Model).HasMaxLength(100);
        b.Entity<DemandForecast>().Property(x => x.Estimate).HasPrecision(12, 2);
        b.Entity<DemandForecast>().Property(x => x.InputsJson).HasColumnType("nvarchar(max)");
        b.Entity<DemandForecast>().HasIndex(x => new { x.CrisisId, x.Category, x.CreatedAt });
        Fk<CrisisBriefing, Crisis>(b, nameof(CrisisBriefing.CrisisId));
        b.Entity<CrisisBriefing>().Property(x => x.FactsJson).HasColumnType("nvarchar(max)");
        b.Entity<CrisisBriefing>().HasIndex(x => new { x.CrisisId, x.CreatedAt });
        Fk<InvestigationFlag, AssistanceRequest>(b, nameof(InvestigationFlag.RequestId));
        Fk<InvestigationFlag, Donation>(b, nameof(InvestigationFlag.DonationId));
        b.Entity<InvestigationFlag>().Property(x => x.Category).HasMaxLength(100);
        b.Entity<InvestigationFlag>().Property(x => x.Outcome).HasConversion<string>().HasMaxLength(50);
        b.Entity<InvestigationFlag>().HasIndex(x => new { x.RequestId, x.Category }).IsUnique().HasFilter("[RequestId] IS NOT NULL");
        b.Entity<InvestigationFlag>().HasIndex(x => new { x.DonationId, x.Category }).IsUnique().HasFilter("[DonationId] IS NOT NULL");
        b.Entity<InvestigationFlag>().ToTable(t => t.HasCheckConstraint("CK_InvestigationFlag_Subject",
            "([RequestId] IS NOT NULL AND [DonationId] IS NULL) OR ([RequestId] IS NULL AND [DonationId] IS NOT NULL)"));
        Fk<CaseConsolidation, AssistanceRequest>(b, nameof(CaseConsolidation.OriginalRequestId));
        Fk<CaseConsolidation, AssistanceRequest>(b, nameof(CaseConsolidation.PrimaryRequestId));
        b.Entity<CaseConsolidation>().HasIndex(x => x.OriginalRequestId).IsUnique();
        b.Entity<CaseConsolidation>().ToTable(t => t.HasCheckConstraint("CK_CaseConsolidation_Distinct", "[OriginalRequestId] <> [PrimaryRequestId]"));
    }
    private static void ConfigureFunding(ModelBuilder b)
    {
        Fk<DonorProfile, AppUser>(b, nameof(DonorProfile.UserId));
        b.Entity<DonorProfile>().HasIndex(x => x.UserId).IsUnique();
        b.Entity<DonorProfile>().Property(x => x.DisplayName).HasMaxLength(100);
        b.Entity<DonorProfile>().Property(x => x.OrganisationName).HasMaxLength(150);
        b.Entity<FundingCampaign>().Property(x => x.CountryCode).HasMaxLength(2).IsUnicode(false);
        b.Entity<FundingCampaign>().Property(x => x.Currency).HasMaxLength(3).IsUnicode(false);
        b.Entity<FundingCampaign>().Property(x => x.Name).HasMaxLength(150);
        b.Entity<FundingCampaign>().Property(x => x.Purpose).HasMaxLength(1000);
        b.Entity<FundingCampaign>().HasIndex(x => new { x.CountryCode, x.OrganisationId });
        b.Entity<FundingCampaign>().HasOne<Country>().WithMany().HasForeignKey(x => x.CountryCode)
            .HasPrincipalKey(x => x.Code).OnDelete(DeleteBehavior.Restrict);
        b.Entity<FundingCampaign>().HasOne<Crisis>().WithMany().HasForeignKey(x => new { x.CrisisId, x.CountryCode })
            .HasPrincipalKey(x => new { x.Id, x.CountryCode }).OnDelete(DeleteBehavior.Restrict);
        Fk<FundingCampaign, Organisation>(b, nameof(FundingCampaign.OrganisationId));
        Fk<Donation, FundingCampaign>(b, nameof(Donation.CampaignId));
        Fk<Donation, DonorProfile>(b, nameof(Donation.DonorId));
        Fk<Donation, StockMovement>(b, nameof(Donation.StockMovementId));
        Fk<Donation, Resource>(b, nameof(Donation.ResourceId));
        b.Entity<Donation>().Property(x => x.ReceiptReference).HasMaxLength(100);
        b.Entity<Donation>().Property(x => x.Unit).HasMaxLength(30);
        b.Entity<Donation>().HasIndex(x => x.StockMovementId).IsUnique();
        b.Entity<Donation>().HasIndex(x => new { x.CampaignId, x.ReceiptReference });
        Fk<DonationAllocation, Donation>(b, nameof(DonationAllocation.DonationId));
        Fk<DonationAllocation, AssistanceRequest>(b, nameof(DonationAllocation.RequestId));
        Fk<DonationExpenditure, DonationAllocation>(b, nameof(DonationExpenditure.AllocationId));
        Fk<DonationExpenditure, DeliveryConfirmation>(b, nameof(DonationExpenditure.DeliveryConfirmationId));
        b.Entity<DonationExpenditure>().HasIndex(x => x.DeliveryConfirmationId).IsUnique();
        b.Entity<DonationExpenditure>().Property(x => x.Reference).HasMaxLength(100);
        Fk<DonationEvent, Donation>(b, nameof(DonationEvent.DonationId));
        b.Entity<DonationEvent>().HasIndex(x => new { x.DonationId, x.CreatedAt });
        b.Entity<FundingCampaign>().ToTable(t => t.HasCheckConstraint("CK_FundingCampaign_Budget", "[Budget] > 0"));
        b.Entity<Donation>().ToTable(t => t.HasCheckConstraint("CK_Donation_Amount", "[Amount] > 0"));
        b.Entity<DonationAllocation>().ToTable(t => t.HasCheckConstraint("CK_DonationAllocation_Amount", "[Amount] > 0"));
        b.Entity<DonationExpenditure>().ToTable(t => t.HasCheckConstraint("CK_DonationExpenditure_Amount", "[Amount] > 0"));
    }
    private static void ConfigurePublicReferences(ModelBuilder builder)
    {
        foreach (var prefix in new[] { "SK", "RES", "DSP", "TRF", "SR" })
            builder.HasSequence<long>(prefix + "ReferenceNumbers", "dbo").StartsAt(1001);

        foreach (var type in new[] { typeof(AssistanceRequest), typeof(Resource), typeof(ResourceAllocation), typeof(LogisticsOrder), typeof(SupplyRequest), typeof(CaseDispatch) })
        {
            builder.Entity(type).Property<string>(nameof(AssistanceRequest.Reference)).HasMaxLength(30);
            builder.Entity(type).HasIndex(nameof(AssistanceRequest.Reference)).IsUnique();
        }
        builder.Entity<AssistanceRequest>().Property(r => r.LegacyReference).HasMaxLength(30);
        builder.Entity<AssistanceRequest>().HasIndex(r => r.LegacyReference).IsUnique();
        builder.Entity<SupplyRequest>().Property(r => r.LegacyReference).HasMaxLength(30);
    }

    private static void Fk<T, TParent>(ModelBuilder b, string field) where T : class where TParent : class => b.Entity<T>().HasOne<TParent>().WithMany().HasForeignKey(field).OnDelete(DeleteBehavior.Restrict);
    public override Task<int> SaveChangesAsync(CancellationToken ct = default) => SaveChangesAsync(true, ct);

    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken ct = default)
    {
        foreach (var entry in ChangeTracker.Entries<Record>())
        {
            if (entry.State == EntityState.Modified)
                entry.Entity.UpdatedAt = DateTimeOffset.UtcNow;
            if (entry.State != EntityState.Added)
                continue;

            var prefix = entry.Entity switch
            {
                AssistanceRequest => "SK",
                Resource => "RES",
                ResourceAllocation => "DSP",
                CaseDispatch => "DSP",
                LogisticsOrder { Kind: LogisticsOrderKind.Transfer } => "TRF",
                LogisticsOrder => "DSP",
                SupplyRequest => "SR",
                _ => null,
            };
            if (prefix is null)
                continue;

            var reference = entry.Property<string>(nameof(AssistanceRequest.Reference));
            if (string.IsNullOrEmpty(reference.CurrentValue))
            {
                // Prefixes come from the entity types above. SQL Server allocates each number atomically.
                var sql = "SELECT NEXT VALUE FOR [dbo].[" + prefix + "ReferenceNumbers] AS [Value]";
                var values = await Database.SqlQueryRaw<long>(sql).ToListAsync(ct);
                reference.CurrentValue = prefix + "-" + values.Single().ToString(CultureInfo.InvariantCulture);
            }
        }
        return await base.SaveChangesAsync(acceptAllChangesOnSuccess, ct);
    }
}
public sealed class EfStore(CrisisDbContext db) : IStore
{
    public IQueryable<string> ActiveSystemAdministratorIds => db.ActiveSystemAdministrators.Select(u => u.Id);
    public IQueryable<T> Query<T>() where T : Record => db.Set<T>();
    public Task<List<T>> ListAsync<T>(IQueryable<T> query, CancellationToken ct = default) => query.ToListAsync(ct);
    public async Task<T?> FindAsync<T>(Guid id, CancellationToken ct = default) where T : Record => await db.Set<T>().FindAsync([id], ct);
    public void Add<T>(T entity) where T : Record => db.Add(entity);
    public void Remove<T>(T entity) where T : Record => db.Remove(entity);
    public async Task SaveAsync(CancellationToken ct = default) => await db.SaveChangesAsync(ct);
    public async Task<T> TransactionAsync<T>(Func<Task<T>> operation, CancellationToken ct = default)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var result = await operation();
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return result;
    }
    public Task<T> RoutingTransactionAsync<T>(Func<Task<T>> operation, CancellationToken ct = default) =>
        LockedTransactionAsync("Surakuma.RequestRouting", operation, ct);

    public Task<T> FeedbackTransactionAsync<T>(Guid requestId, Func<Task<T>> operation, CancellationToken ct = default) =>
        LockedTransactionAsync($"Surakuma.Feedback.{requestId:N}", operation, ct);

    private async Task<T> LockedTransactionAsync<T>(string resource, Func<Task<T>> operation, CancellationToken ct)
    {
        // Acquire the application lock before reads so callers make decisions against committed state.
        for (int attempt = 0; ; attempt++)
        {
            try
            {
                await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
                await db.Database.ExecuteSqlInterpolatedAsync($"DECLARE @result int; EXEC @result = sp_getapplock @Resource = {resource}, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 30000; IF @result < 0 THROW 51001, 'Could not acquire the request operation lock.', 1;", ct);
                var result = await operation();
                await db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
                return result;
            }
            catch (Exception ex) when (attempt < 3 && IsDeadlock(ex))
            {
                db.ChangeTracker.Clear();
                await Task.Delay(TimeSpan.FromMilliseconds(50 * (attempt + 1) + Random.Shared.Next(50)), ct);
            }
        }
    }
    internal static bool IsDeadlock(Exception exception) => exception is SqlException { Number: 1205 } || (exception.InnerException is not null && IsDeadlock(exception.InnerException));
}
public sealed class CurrentActor(IHttpContextAccessor context) : ICurrentActor
{
    public string? SelectedCountry => context.HttpContext?.Request.Query["countryCode"].FirstOrDefault();
    public string? SelectedStaffRole => context.HttpContext?.Request.Query["staffRole"].FirstOrDefault();
    public string Id => context.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw new AccessDeniedException();
}
