using System.ComponentModel.DataAnnotations;
using Surakuma.Domain;

namespace Surakuma.Application;

public sealed record DonorInput([Required, MaxLength(100)] string DisplayName, [MaxLength(150)] string? OrganisationName);
public sealed record CampaignInput(Guid OrganisationId, Guid? CrisisId, [Required, MaxLength(150)] string Name,
    [Required, MaxLength(1000)] string Purpose, decimal Budget);
public sealed record PledgeInput(Guid OperationId, Guid CampaignId, DonationKind Kind, AidCategory Category, decimal Amount,
    [MaxLength(30)] string? Unit);
public sealed record FundingReceiptInput([Required, MaxLength(100)] string Reference, Guid? ResourceId);
public sealed record CampaignStateInput(bool Open);
public sealed record FundingAllocationInput(Guid OperationId, Guid RequestId, decimal Amount);
public sealed record FundingExpenseInput(Guid OperationId, decimal Amount, [Required, MaxLength(100)] string Reference, Guid? DeliveryConfirmationId);
public sealed record FundingTotals(Guid CampaignId, decimal Pledged, decimal Received, decimal Allocated, decimal Expended, decimal Budget);
public sealed record MaterialFundingTotals(Guid CampaignId, AidCategory Category, string Unit, decimal Received, decimal Allocated, decimal Distributed);
public sealed record DonationView(Guid Id, Guid CampaignId, DonationKind Kind, AidCategory Category, string Unit,
    decimal Amount, DonationState State, Guid? ResourceId, string? Donor, string? ReceiptReference);
public sealed record FundingAllocationView(Guid Id, Guid DonationId, Guid? RequestId, decimal Amount);
public sealed record FundingExpenseView(Guid Id, Guid AllocationId, decimal Amount, string? Reference);
public sealed record FundingWorkspace(bool CanManage, DonorProfile? Profile, List<FundingCampaign> Campaigns,
    List<DonationView> Donations, List<FundingAllocationView> Allocations, List<FundingExpenseView> Expenses,
    List<DonationEvent> Events, List<FundingTotals> Reports, List<MaterialFundingTotals> MaterialReports, List<InvestigationFlag> Flags);
public sealed record CampaignOption(Guid Id, string Name, Guid OrganisationId, Guid? CrisisId);
public sealed record FundingCaseOption(Guid Id, string Reference, AidCategory Category);
public sealed record FundingInventoryOption(Guid Id, string Name, AidCategory Category, string Unit);
public sealed record FundingDeliveryOption(Guid Id, Guid RequestId, Guid ResourceId, string Reference, decimal Quantity);
public sealed record FundingOptions(List<CampaignOption> CampaignScopes, List<FundingCaseOption> Cases,
    List<FundingInventoryOption> Resources, List<FundingDeliveryOption> Deliveries);

public sealed class FundingService(IStore store, AccessService access, Operations operations, DecisionSupportService decisionSupport,
    InternalNotifications notifications)
{
    private static readonly string[] Officers = [Roles.FundingOfficer];

    public async Task<FundingWorkspace> Workspace(string country, bool manage, CancellationToken ct)
    {
        var profile = manage ? null : await Profile(ct);
        var scope = await CampaignScope(country, manage, ct);
        var campaigns = await store.ListAsync(scope.OrderByDescending(x => x.CreatedAt), ct);
        var query = store.Query<Donation>().Where(d => scope.Any(c => c.Id == d.CampaignId));
        var reports = await store.ListAsync(scope.Select(c => new FundingTotals(c.Id,
            manage ? query.Where(d => d.CampaignId == c.Id && d.Kind == DonationKind.Monetary && d.State == DonationState.Pledged).Sum(d => (decimal?)d.Amount) ?? 0 : 0,
            query.Where(d => d.CampaignId == c.Id && d.Kind == DonationKind.Monetary && d.ReceiptReference != null).Sum(d => (decimal?)d.Amount) ?? 0,
            store.Query<DonationAllocation>().Where(a => query.Any(d => d.Id == a.DonationId && d.Kind == DonationKind.Monetary && d.CampaignId == c.Id)).Sum(a => (decimal?)a.Amount) ?? 0,
            store.Query<DonationExpenditure>().Where(e => store.Query<DonationAllocation>().Any(a => a.Id == e.AllocationId &&
                query.Any(d => d.Id == a.DonationId && d.Kind == DonationKind.Monetary && d.CampaignId == c.Id))).Sum(e => (decimal?)e.Amount) ?? 0, c.Budget)), ct);
        var material = await store.ListAsync(query.Where(d => d.Kind == DonationKind.Material && d.ReceiptReference != null)
            .Select(d => new MaterialFundingTotals(d.CampaignId, d.Category, d.Unit, d.Amount,
                store.Query<DonationAllocation>().Where(a => a.DonationId == d.Id).Sum(a => (decimal?)a.Amount) ?? 0,
                store.Query<DonationExpenditure>().Where(e => store.Query<DonationAllocation>().Any(a =>
                    a.Id == e.AllocationId && a.DonationId == d.Id)).Sum(e => (decimal?)e.Amount) ?? 0)), ct);
        var materialReports = material.GroupBy(r => (r.CampaignId, r.Category, r.Unit))
            .Select(g => new MaterialFundingTotals(g.Key.CampaignId, g.Key.Category, g.Key.Unit,
                g.Sum(x => x.Received), g.Sum(x => x.Allocated), g.Sum(x => x.Distributed))).ToList();
        if (!manage) query = query.Where(d => d.DonorId == (profile == null ? Guid.Empty : profile.Id));
        var donations = await store.ListAsync(query.OrderByDescending(d => d.CreatedAt).Select(d => new DonationView(
            d.Id, d.CampaignId, d.Kind, d.Category, d.Unit, d.Amount, d.State, manage ? d.ResourceId : null,
            manage ? store.Query<DonorProfile>().Where(p => p.Id == d.DonorId).Select(p => p.DisplayName).FirstOrDefault() : null,
            manage ? d.ReceiptReference : null)), ct);
        var allocations = store.Query<DonationAllocation>().Where(a => query.Any(d => d.Id == a.DonationId));
        return new(manage, profile, campaigns, donations,
            await store.ListAsync(allocations.Select(a => new FundingAllocationView(a.Id, a.DonationId, manage ? a.RequestId : null, a.Amount)), ct),
            await store.ListAsync(store.Query<DonationExpenditure>().Where(e => allocations.Any(a => a.Id == e.AllocationId))
                .Select(e => new FundingExpenseView(e.Id, e.AllocationId, e.Amount, manage ? e.Reference : null)), ct),
            await store.ListAsync(store.Query<DonationEvent>().Where(e => query.Any(d => d.Id == e.DonationId)).OrderByDescending(e => e.CreatedAt), ct), reports, materialReports,
            manage ? await store.ListAsync(store.Query<InvestigationFlag>().Where(f => query.Any(d => d.Id == f.DonationId))
                .OrderBy(f => f.ReviewedAt != null).ThenByDescending(f => f.CreatedAt).Take(100), ct) : []);
    }

    public async Task<FundingOptions> Options(string country, Guid? campaignId, CancellationToken ct)
    {
        var manageable = await CampaignScope(country, true, ct);
        var global = await access.CountryAccess(country, [], ct);
        var grants = store.Query<Membership>().Where(m => m.UserId == access.UserId && m.CountryCode == country && m.Role == Roles.FundingOfficer);
        var registrations = store.Query<OrganisationCountry>().Where(link => link.CountryCode == country &&
            (link.VerificationState == "Verified" || link.VerificationState == "LegacyActive"));
        var organisations = store.Query<Organisation>().Where(o => registrations.Any(link => link.OrganisationId == o.Id));
        if (campaignId == null)
        {
            var national = await store.ListAsync(organisations.Where(o => global || grants.Any(g => g.OrganisationId == o.Id && g.CrisisId == null))
                .Select(o => new CampaignOption(o.Id, o.Name, o.Id, null)), ct);
            var crisisOptions = await store.ListAsync(from o in organisations
                from crisis in store.Query<Crisis>().Where(c => c.CountryCode == country && c.Active)
                where global || grants.Any(g => g.OrganisationId == o.Id && (g.CrisisId == null || g.CrisisId == crisis.Id))
                select new CampaignOption(crisis.Id, o.Name + " / " + crisis.Name, o.Id, crisis.Id), ct);
            return new(national.Concat(crisisOptions).OrderBy(o => o.Name).ToList(), [], [], []);
        }
        var campaign = (await store.ListAsync(manageable.Where(c => c.Id == campaignId), ct)).SingleOrDefault() ?? throw new MissingException();
        var crises = store.Query<Crisis>().Where(c => c.CountryCode == country && (campaign.CrisisId == null || campaign.CrisisId == c.Id));
        var cases = store.Query<AssistanceRequest>().Where(r => r.OrganisationId == campaign.OrganisationId && crises.Any(c => c.Id == r.CrisisId));
        var options = await store.ListAsync(cases.Where(r => r.Status == RequestStatus.Approved || r.Status == RequestStatus.InProgress ||
            r.Status == RequestStatus.PartiallyFulfilled || r.Status == RequestStatus.Fulfilled).OrderByDescending(r => r.CreatedAt)
            .Take(100).Select(r => new FundingCaseOption(r.Id, r.Reference, r.Category)), ct);
        var resources = await store.ListAsync((await access.Located<Resource>(ct, campaign.CrisisId, [Roles.Logistics]))
            .Where(r => r.CountryCode == country && r.OrganisationId == campaign.OrganisationId)
            .OrderBy(r => r.Name).Select(r => new FundingInventoryOption(r.Id, r.Name, r.Category, r.Unit)), ct);
        var deliveries = await store.ListAsync(from receipt in store.Query<DeliveryConfirmation>()
            join shipment in store.Query<ResourceAllocation>() on receipt.AllocationId equals (Guid?)shipment.Id
            where receipt.ConfirmedQuantity > 0 && cases.Any(r => r.Id == shipment.RequestId)
                && !store.Query<DonationExpenditure>().Any(e => e.DeliveryConfirmationId == receipt.Id)
            orderby receipt.CreatedAt descending
            select new FundingDeliveryOption(receipt.Id, shipment.RequestId, shipment.ResourceId, receipt.Reference, receipt.ConfirmedQuantity), ct);
        return new([], options, resources, deliveries);
    }

    public Task<DonorProfile> Register(DonorInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var profile = await Profile(ct);
        var created = profile == null;
        if (profile == null)
        {
            profile = new DonorProfile { UserId = access.UserId };
            store.Add(profile);
        }
        profile.DisplayName = Required(input.DisplayName);
        profile.OrganisationName = string.IsNullOrWhiteSpace(input.OrganisationName) ? null : input.OrganisationName.Trim();
        operations.Audit(created ? "DonorRegistered" : "DonorProfileUpdated", profile);
        return profile;
    }, ct);

    public Task<FundingCampaign> CreateCampaign(string country, CampaignInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        await access.RequireLocation(input.OrganisationId, country, Officers, ct, input.CrisisId);
        var currency = country switch { "LK" => "LKR", "IN" => "INR", "NP" => "NPR", _ => throw new RuleException("Select a supported country.") };
        await access.RequirePartner(input.OrganisationId, country, ct);
        if (input.CrisisId is Guid crisisId && (await store.FindAsync<Crisis>(crisisId, ct))?.CountryCode != country)
            throw new RuleException("The crisis must belong to the campaign country.");
        var campaign = new FundingCampaign { CountryCode = country, OrganisationId = input.OrganisationId, CrisisId = input.CrisisId,
            Name = Required(input.Name), Purpose = Required(input.Purpose), Currency = currency, Budget = Amount(input.Budget) };
        store.Add(campaign);
        operations.Audit("FundingCampaignCreated", campaign, countryCode: country);
        await notifications.FundingChanged(campaign, "A funding campaign opened.", ct);
        return campaign;
    }, ct);

    public Task<FundingCampaign> SetCampaignState(string country, Guid id, CampaignStateInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var campaign = await ReadCampaign(id, country, ct);
        await Manage(campaign, ct);
        if (campaign.Open == input.Open) return campaign;
        if (input.Open) await access.RequirePartner(campaign.OrganisationId, country, ct);
        campaign.Open = input.Open;
        operations.Audit(input.Open ? "FundingCampaignReopened" : "FundingCampaignClosed", campaign, countryCode: country);
        await notifications.FundingChanged(campaign, input.Open ? "A funding campaign reopened." : "A funding campaign closed.", ct);
        return campaign;
    }, ct);

    public Task<DonationView> Pledge(string country, PledgeInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var donor = await Profile(ct) ?? throw new RuleException("Create your donor profile before recording a pledge.");
        var campaign = await ReadCampaign(input.CampaignId, country, ct);
        var amount = Amount(input.Amount);
        var unit = input.Kind == DonationKind.Monetary ? campaign.Currency : Required(input.Unit).ToLowerInvariant();
        if (input.Kind == DonationKind.Material) QuantityUnits.ValidateInventory(amount, unit);
        var id = Operation(input.OperationId);
        if (await store.FindAsync<Donation>(id, ct) is { } existing)
        {
            if (existing.DonorId != donor.Id) throw new MissingException();
            if (existing.CampaignId != campaign.Id || existing.Amount != amount || existing.Kind != input.Kind ||
                existing.Category != input.Category || existing.Unit != unit)
                throw new RuleException("This operation reference belongs to another pledge.");
            return OwnView(existing);
        }
        if (!campaign.Open) throw new RuleException("This campaign is closed.");
        await access.RequirePartner(campaign.OrganisationId, country, ct);
        var donation = new Donation { Id = id, CampaignId = campaign.Id, DonorId = donor.Id, Amount = amount,
            Category = input.Category, Kind = input.Kind, Unit = unit };
        store.Add(donation);
        await Record(donation, campaign, "Pledged", ct);
        if (donation.Kind == DonationKind.Monetary && donation.Amount > campaign.Budget)
            Flag(donation, campaign, "Pledge exceeds campaign budget", "The stated pledge is greater than the recorded campaign budget. Verify the amount and funding context.");
        return OwnView(donation);
    }, ct);

    public Task<DonationView> Cancel(string country, Guid id, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var (donation, campaign) = await LoadDonation(id, country, ct);
        if ((await Profile(ct))?.Id != donation.DonorId) throw new MissingException();
        if (donation.State != DonationState.Cancelled)
        {
            RequireState(donation, DonationState.Pledged);
            donation.State = DonationState.Cancelled;
            await Record(donation, campaign, "Pledge cancelled", ct);
        }
        return OwnView(donation);
    }, ct);

    public Task<Donation> Confirm(string country, Guid id, FundingReceiptInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var (donation, campaign) = await LoadDonation(id, country, ct);
        await Manage(campaign, ct);
        var donor = await store.FindAsync<DonorProfile>(donation.DonorId, ct) ?? throw new MissingException();
        if (donor.UserId == access.UserId) throw new RuleException("Another authorized staff member must verify your donation.");
        var reference = Required(input.Reference);
        if (donation.ReceiptReference == reference && donation.ResourceId == input.ResourceId) return donation;
        RequireState(donation, DonationState.Pledged);
        if ((await store.ListAsync(store.Query<Donation>().Where(d => d.ReceiptReference == reference &&
            store.Query<FundingCampaign>().Any(c => c.Id == d.CampaignId && c.CountryCode == country &&
                c.OrganisationId == campaign.OrganisationId)).Take(1), ct)).Count > 0)
            throw new RuleException("This receipt reference was already used by this organisation in this country.");
        if (donation.Kind == DonationKind.Material)
        {
            var resource = await store.FindAsync<Resource>(input.ResourceId ?? Guid.Empty, ct) ?? throw new MissingException();
            if (resource.CountryCode != country || resource.OrganisationId != campaign.OrganisationId ||
                resource.Category != donation.Category || !SameUnit(resource.Unit, donation.Unit))
                throw new RuleException("Select inventory in the campaign organisation and country with matching category and unit.");
            await access.RequireLocation(resource.OrganisationId, country, [Roles.Logistics], ct, campaign.CrisisId);
            resource.ChangePhysical(donation.Amount);
            var movement = new StockMovement { ResourceId = resource.Id, OperationId = donation.Id, Kind = "DonationReceived",
                CrisisId = campaign.CrisisId, Quantity = donation.Amount, ActorId = access.UserId, Note = reference, Destination = resource.LocationText };
            store.Add(movement);
            donation.StockMovementId = movement.Id;
            donation.ResourceId = resource.Id;
            operations.Audit("DonationStockReceived", resource, movement.Id.ToString(), country);
        }
        else if (input.ResourceId != null) throw new RuleException("A monetary receipt cannot credit inventory.");
        donation.ReceiptReference = reference;
        donation.State = DonationState.Confirmed;
        await Record(donation, campaign, "Receipt verified", ct);
        return donation;
    }, ct);

    public Task<DonationAllocation> Allocate(string country, Guid id, FundingAllocationInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var (donation, campaign) = await LoadDonation(id, country, ct);
        await Manage(campaign, ct);
        var operation = Operation(input.OperationId);
        var amount = Amount(input.Amount);
        if (await store.FindAsync<DonationAllocation>(operation, ct) is { } previous)
        {
            if (previous.DonationId != id || previous.RequestId != input.RequestId || previous.Amount != amount)
                throw new RuleException("This operation reference belongs to another allocation.");
            return previous;
        }
        if (donation.ReceiptReference == null || donation.State == DonationState.Cancelled)
            throw new RuleException("Verify the donation receipt before allocating it.");
        var request = await store.FindAsync<AssistanceRequest>(input.RequestId, ct) ?? throw new MissingException();
        var crisis = await store.FindAsync<Crisis>(request.CrisisId, ct) ?? throw new MissingException();
        if (crisis.CountryCode != country || request.OrganisationId != campaign.OrganisationId ||
            campaign.CrisisId.HasValue && campaign.CrisisId != request.CrisisId)
            throw new AccessDeniedException();
        if (request.Status is not (RequestStatus.Approved or RequestStatus.InProgress or RequestStatus.PartiallyFulfilled or RequestStatus.Fulfilled))
            throw new RuleException("Choose an approved case.");
        if (donation.Kind == DonationKind.Material)
        {
            if (donation.Category != request.Category)
                throw new RuleException("Material allocations must match the case category. Verify that the units suit the case.");
            QuantityUnits.ValidateInventory(amount, donation.Unit);
        }
        var allocated = (await store.ListAsync(store.Query<DonationAllocation>().Where(a => a.DonationId == id).Select(a => a.Amount), ct)).Sum();
        if (amount > donation.Amount - allocated) throw new RuleException("The allocation exceeds the confirmed unallocated balance.");
        var allocation = new DonationAllocation { Id = operation, DonationId = id, RequestId = request.Id, Amount = amount };
        store.Add(allocation);
        donation.State = DonationState.Allocated;
        await Record(donation, campaign, "Aid allocation recorded", ct);
        operations.Audit("DonationAllocationCreated", allocation, id.ToString(), country);
        return allocation;
    }, ct);

    public Task<DonationExpenditure> Expend(string country, Guid allocationId, FundingExpenseInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var allocation = await store.FindAsync<DonationAllocation>(allocationId, ct) ?? throw new MissingException();
        var (donation, campaign) = await LoadDonation(allocation.DonationId, country, ct);
        await Manage(campaign, ct);
        var amount = Amount(input.Amount);
        var operation = Operation(input.OperationId);
        var reference = Required(input.Reference);
        if (await store.FindAsync<DonationExpenditure>(operation, ct) is { } previous)
        {
            if (previous.AllocationId != allocationId || previous.Amount != amount ||
                previous.Reference != reference || previous.DeliveryConfirmationId != input.DeliveryConfirmationId)
                throw new RuleException("This operation reference belongs to another expenditure.");
            return previous;
        }
        var expenses = store.Query<DonationExpenditure>();
        var spent = (await store.ListAsync(expenses.Where(e => e.AllocationId == allocationId).Select(e => e.Amount), ct)).Sum();
        if (amount > allocation.Amount - spent) throw new RuleException("This amount exceeds the allocation balance.");
        var campaignAllocations = store.Query<DonationAllocation>().Where(a =>
            store.Query<Donation>().Any(d => d.CampaignId == campaign.Id && d.Id == a.DonationId && d.Kind == donation.Kind));
        if (donation.Kind == DonationKind.Monetary)
        {
            if (input.DeliveryConfirmationId != null) throw new RuleException("Use an external expense reference for a financial expenditure.");
            var campaignExpenses = await store.ListAsync(expenses.Where(e => campaignAllocations.Any(a => a.Id == e.AllocationId)), ct);
            if (campaignExpenses.Any(e => e.Reference.Equals(reference, StringComparison.OrdinalIgnoreCase)))
                throw new RuleException("This expenditure reference was already used in the campaign.");
            if (amount + campaignExpenses.Sum(e => e.Amount) > campaign.Budget)
                throw new RuleException("This expenditure exceeds the campaign budget.");
        }
        else
        {
            QuantityUnits.ValidateInventory(amount, donation.Unit);
            var receipt = await store.FindAsync<DeliveryConfirmation>(input.DeliveryConfirmationId ?? Guid.Empty, ct) ?? throw new MissingException();
            var shipment = await store.FindAsync<ResourceAllocation>(receipt.AllocationId ?? Guid.Empty, ct) ?? throw new MissingException();
            if (shipment.RequestId != allocation.RequestId || shipment.ResourceId != donation.ResourceId || amount > receipt.ConfirmedQuantity)
                throw new RuleException("Use the confirmed delivery receipt for this case and inventory item.");
            if ((await store.ListAsync(expenses.Where(e => e.DeliveryConfirmationId == receipt.Id).Take(1), ct)).Count > 0)
                throw new RuleException("This delivery receipt is already attributed to a material donation.");
        }
        var expense = new DonationExpenditure { Id = operation, AllocationId = allocationId, Amount = amount,
            Reference = reference, DeliveryConfirmationId = input.DeliveryConfirmationId };
        store.Add(expense);
        var donationAllocations = store.Query<DonationAllocation>().Where(a => a.DonationId == donation.Id);
        var used = (await store.ListAsync(expenses.Where(e => donationAllocations.Any(a => a.Id == e.AllocationId)).Select(e => e.Amount), ct)).Sum();
        if (used + amount == donation.Amount) donation.State = DonationState.Distributed;
        await Record(donation, campaign, donation.Kind == DonationKind.Material ? "Confirmed delivery attributed" : "Expenditure recorded", ct);
        operations.Audit("DonationExpenditureCreated", expense, donation.Id.ToString(), country);
        return expense;
    }, ct);

    public Task<InvestigationFlag> ReviewFlag(string country, Guid flagId, InvestigationReview input, CancellationToken ct) =>
        store.TransactionAsync(async () =>
        {
            var flag = await store.FindAsync<InvestigationFlag>(flagId, ct) ?? throw new MissingException();
            if (flag.DonationId is not Guid donationId) throw new MissingException();
            var (_, campaign) = await LoadDonation(donationId, country, ct);
            await Manage(campaign, ct);
            decisionSupport.ResolveFlag(flag, input, country);
            return flag;
        }, ct);

    public Task<int> ScanLedger(string country, Guid campaignId, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var campaign = await ReadCampaign(campaignId, country, ct);
        await Manage(campaign, ct);
        var donations = store.Query<Donation>().Where(d => d.CampaignId == campaignId);
        var allocations = store.Query<DonationAllocation>().Where(a => donations.Any(d => d.Id == a.DonationId));
        var expenses = await store.ListAsync(store.Query<DonationExpenditure>().Where(e => allocations.Any(a => a.Id == e.AllocationId)), ct);
        var byDonation = (await store.ListAsync(allocations, ct)).ToLookup(a => a.DonationId);
        var totals = expenses.GroupBy(e => e.AllocationId).ToDictionary(g => g.Key, g => g.Sum(e => e.Amount));
        var raised = await store.ListAsync(store.Query<InvestigationFlag>().Where(f => donations.Any(d => d.Id == f.DonationId))
            .Select(f => new { f.DonationId, f.Category }), ct);
        var keys = raised.Select(f => (f.DonationId!.Value, f.Category)).ToHashSet();
        int inserted = 0;
        foreach (var donation in await store.ListAsync(donations, ct))
        {
            var entries = byDonation[donation.Id];
            if (entries.Sum(a => a.Amount) > donation.Amount || entries.Any(a => totals.GetValueOrDefault(a.Id) > a.Amount) ||
                (entries.Any() && donation.ReceiptReference == null) ||
                (donation.Kind == DonationKind.Material && donation.ReceiptReference != null && donation.StockMovementId == null))
                Add("Ledger balance discrepancy", "The confirmed receipt, allocations or expenditures do not reconcile. Review the source documents.");
            if (entries.GroupBy(a => a.RequestId).Any(g => g.Count() >= 3))
                Add("Repeated allocation", "Three or more funding entries for this donation refer to the same case. This may reflect staged support.");

            void Add(string category, string evidence)
            {
                if (!keys.Add((donation.Id, category))) return;
                Flag(donation, campaign, category, evidence);
                inserted++;
            }
        }
        return inserted;
    }, ct);

    private void Flag(Donation donation, FundingCampaign campaign, string category, string evidence)
    {
        var flag = new InvestigationFlag { DonationId = donation.Id, Category = category, Evidence = evidence, Severity = InvestigationSeverity.Advisory };
        store.Add(flag);
        operations.Audit("InvestigationFlagRaised", flag, category, campaign.CountryCode);
    }

    private async Task<IQueryable<FundingCampaign>> CampaignScope(string country, bool manage, CancellationToken ct)
    {
        var campaigns = store.Query<FundingCampaign>().Where(c => c.CountryCode == country);
        if (!manage) return campaigns;
        if (await access.IsAdmin(ct)) return campaigns;
        var grants = store.Query<Membership>().Where(m => m.UserId == access.UserId && m.CountryCode == country &&
            (m.Role == Roles.FundingOfficer || m.Role == Roles.CountryAdministrator));
        if ((await store.ListAsync(grants.Take(1), ct)).Count == 0) throw new AccessDeniedException();
        return campaigns.Where(c => grants.Any(m => m.Role == Roles.CountryAdministrator && m.CrisisId == null ||
            m.Role == Roles.FundingOfficer && m.OrganisationId == c.OrganisationId && (m.CrisisId == null || m.CrisisId == c.CrisisId)));
    }

    private async Task<DonorProfile?> Profile(CancellationToken ct) =>
        (await store.ListAsync(store.Query<DonorProfile>().Where(p => p.UserId == access.UserId).Take(1), ct)).SingleOrDefault();

    private async Task<FundingCampaign> ReadCampaign(Guid id, string country, CancellationToken ct)
    {
        var campaign = await store.FindAsync<FundingCampaign>(id, ct) ?? throw new MissingException();
        if (campaign.CountryCode != country) throw new MissingException();
        return campaign;
    }

    private async Task<(Donation, FundingCampaign)> LoadDonation(Guid id, string country, CancellationToken ct)
    {
        var donation = await store.FindAsync<Donation>(id, ct) ?? throw new MissingException();
        return (donation, await ReadCampaign(donation.CampaignId, country, ct));
    }

    private Task Manage(FundingCampaign campaign, CancellationToken ct) =>
        access.RequireLocation(campaign.OrganisationId, campaign.CountryCode, Officers, ct, campaign.CrisisId);

    private async Task Record(Donation donation, FundingCampaign campaign, string activity, CancellationToken ct)
    {
        var profile = await store.FindAsync<DonorProfile>(donation.DonorId, ct) ?? throw new MissingException();
        var entry = new DonationEvent { DonationId = donation.Id, State = donation.State, Activity = activity };
        store.Add(entry);
        // The outbox checks the existing citizen email policy at send time. Keep financial details in the authenticated portal.
        store.Add(new OutboxMessage { Id = entry.Id, UserId = profile.UserId, FundingCountryCode = campaign.CountryCode,
            Message = "Your donation activity was updated. Sign in to view the details.",
            SinhalaMessage = "ඔබගේ පරිත්‍යාග තොරතුරු යාවත්කාලීන කර ඇත. විස්තර බැලීමට පිවිසෙන්න.",
            TamilMessage = "உங்கள் நன்கொடை விவரங்கள் புதுப்பிக்கப்பட்டுள்ளன. விவரங்களைப் பார்க்க உள்நுழையவும்." });
        await notifications.FundingChanged(campaign, "Donation activity updated · " + activity + ".", ct);
        operations.Audit("Donation" + activity.Replace(" ", ""), donation, countryCode: campaign.CountryCode);
    }

    private static void RequireState(Donation donation, DonationState state)
    {
        if (donation.State != state) throw new RuleException($"This action requires a {state.ToString().ToLowerInvariant()} donation.");
    }

    private static Guid Operation(Guid value) => value != Guid.Empty ? value : throw new RuleException("An operation reference is required.");
    private static bool SameUnit(string left, string right) => left.Trim().Equals(right.Trim(), StringComparison.OrdinalIgnoreCase);
    private static DonationView OwnView(Donation donation) => new(donation.Id, donation.CampaignId, donation.Kind, donation.Category,
        donation.Unit, donation.Amount, donation.State, null, null, null);
    private static string Required(string? value) => !string.IsNullOrWhiteSpace(value) ? value.Trim() : throw new RuleException("Complete the required fields.");
    private static decimal Amount(decimal value) => value is > 0 and <= 10000000 && decimal.Round(value, 2) == value
        ? value : throw new RuleException("Use an amount from 0.01 to 10,000,000 with at most two decimal places.");
}
