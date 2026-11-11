using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Surakuma.Domain;

namespace Surakuma.Infrastructure;

public static class SeedData
{
    public static async Task Initialise(CrisisDbContext db, UserManager<AppUser> users, RoleManager<IdentityRole> roles, IConfiguration config)
    {
        foreach (var role in Roles.All)
        if (!await roles.RoleExistsAsync(role))
            await roles.CreateAsync(new IdentityRole(role));
        if (await db.Set<Organisation>().AnyAsync())
            return;
        await using var transaction = await db.Database.BeginTransactionAsync();
        string password = config["Seed:Password"] ?? throw new InvalidOperationException("Set Seed:Password in development configuration.");
        var org = new Organisation { Name = "Surakuma Community Response (demo)" };
        var partner = new Organisation { Name = "Southern Relief Network (demo)" };
        db.AddRange(org, partner);
        db.AddRange(new OrganisationCountry { OrganisationId = org.Id }, new OrganisationCountry { OrganisationId = partner.Id });
        await db.SaveChangesAsync();
        var crisis = new Crisis { Name = "Kelani River flood response", Type = "Flood", District = "Colombo", Latitude = 6.93, Longitude = 79.89, PrimaryOrganisationId = org.Id };
        var landslide = new Crisis { Name = "Hill country landslide response", Type = "Landslide", District = "Ratnapura", Latitude = 6.68, Longitude = 80.40, PrimaryOrganisationId = org.Id };
        db.AddRange(crisis, landslide);
        var accounts = new (string Email, string Name, string Role)[] { ("citizen", "Amara Silva", Roles.Citizen), ("coordinator", "Nimali Perera", Roles.Coordinator), ("case", "Dilan Fernando", Roles.CaseManager), ("logistics", "Kasun Jayasuriya", Roles.Logistics), ("shelter", "Malini De Silva", Roles.ShelterAdmin), ("volunteers", "Ravi Kumar", Roles.VolunteerCoordinator), ("volunteer", "Asha Raman", Roles.Volunteer), ("admin", "System Administrator", Roles.Administrator) };
        var registered = new Dictionary<string, AppUser>();
        foreach (var account in accounts)
        {
            var user = new AppUser { UserName = account.Email + "@surakuma.test", Email = account.Email + "@surakuma.test", DisplayName = account.Name, EmailConfirmed = true, LockoutEnabled = true };
            var result = await users.CreateAsync(user, password);
            if (!result.Succeeded)
                throw new InvalidOperationException(string.Join("; ", result.Errors.Select(x => x.Description)));
            await users.AddToRoleAsync(user, account.Role);
            registered[account.Email] = user;
            if (account.Role == Roles.Citizen)
                db.Add(new Household { UserId = user.Id, Size = 4 });
            else
                db.Add(new Membership { UserId = user.Id, OrganisationId = org.Id, Role = account.Role, AvailableForAssignment = account.Role == Roles.CaseManager });
        }
        db.Add(new CrisisAssignment { CrisisId = crisis.Id, UserId = registered["coordinator"].Id });
        db.Add(new CrisisAssignment { CrisisId = landslide.Id, UserId = registered["coordinator"].Id });
        db.Add(new OperationalArea { CrisisId = crisis.Id, Name = "Kelani response area", GeoJson = "{\"type\":\"Polygon\",\"coordinates\":[[[79.85,6.90],[79.95,6.90],[79.95,6.99],[79.85,6.99],[79.85,6.90]]]}" });
        var volunteer = new VolunteerProfile { UserId = registered["volunteer"].Id, OrganisationId = org.Id, Verified = true, Skills = "distribution, first aid, Sinhala, Tamil", Availability = "Weekdays 09:00–17:00" };
        db.Add(volunteer);
        var food = new AssistanceRequest { CitizenId = registered["citizen"].Id, CrisisId = crisis.Id, OrganisationId = org.Id, Category = AidCategory.FoodWater, Priority = Priority.High, Description = "Synthetic scenario: our household needs food packs and drinking water after flooding.", LocationText = "Kelaniya community collection point (demo)", Latitude = 6.955, Longitude = 79.920, HouseholdSize = 4, Quantity = 10, Status = RequestStatus.Approved, SubmissionKey = "seed-food", Synthetic = true };
        var medical = new AssistanceRequest { CitizenId = registered["citizen"].Id, CrisisId = crisis.Id, OrganisationId = org.Id, Category = AidCategory.Medical, Priority = Priority.Critical, Description = "Synthetic scenario: an elderly household member requires medicine and assistance.", LocationText = "Colombo response point (demo)", Latitude = 6.94, Longitude = 79.88, HouseholdSize = 2, Quantity = 2, Status = RequestStatus.Submitted, SubmissionKey = "seed-medical", Synthetic = true };
        var shelterRequest = new AssistanceRequest { CitizenId = registered["citizen"].Id, CrisisId = crisis.Id, OrganisationId = org.Id, Category = AidCategory.Shelter, Priority = Priority.High, Description = "Synthetic scenario: a household of four needs accessible temporary shelter.", LocationText = "Kelaniya (demo)", Latitude = 6.95, Longitude = 79.92, HouseholdSize = 4, AccessibilityNeeds = "Step-free access", Quantity = 1, Status = RequestStatus.Approved, SubmissionKey = "seed-shelter", Synthetic = true };
        db.AddRange(food, medical, shelterRequest);
        foreach (var r in new[] { food, medical, shelterRequest })
            db.Add(new RequestHistory { RequestId = r.Id, ActorId = registered["coordinator"].Id, Status = r.Status.ToString(), Note = "Synthetic demonstration case seeded at this status." });
        db.AddRange(new Resource { OrganisationId = org.Id, Name = "Family food packs", Category = AidCategory.FoodWater, Unit = "packs", Stock = 6, LocationText = "Colombo depot (demo)", Latitude = 6.92, Longitude = 79.88, Suitability = "Sealed family food packs" }, new Resource { OrganisationId = org.Id, Name = "Medical support kits", Category = AidCategory.Medical, Unit = "kits", Stock = 12, LocationText = "Colombo depot (demo)", Latitude = 6.92, Longitude = 79.88, Suitability = "Non-prescription supplies; staff verify suitability" });
        db.AddRange(new Shelter { OrganisationId = org.Id, Name = "Riverside Community Centre", Address = "Kelaniya · demonstration location", Latitude = 6.957, Longitude = 79.923, Capacity = 150, Accessible = true, Facilities = "Step-free access, water, toilets, family spaces" }, new Shelter { OrganisationId = org.Id, Name = "Central School Hall", Address = "Colombo · demonstration location", Latitude = 6.929, Longitude = 79.882, Capacity = 80, Accessible = true, Facilities = "Water, toilets, first aid" }, new Shelter { OrganisationId = org.Id, Name = "Lakeside Hall", Address = "Colombo · demonstration location", Latitude = 6.91, Longitude = 79.87, Capacity = 20, Accessible = false, Facilities = "Water, toilets" });
        db.Add(new PublicAlert { CrisisId = crisis.Id, Title = "Heavy rain expected", Message = "Demo alert: stay indoors where safe and follow authorised local instructions.", SinhalaTitle = "තද වැසි අපේක්ෂා කෙරේ", SinhalaMessage = "ආදර්ශ නිවේදනය: ආරක්ෂිත ස්ථානයක රැඳී සිටින්න. බලධාරීන්ගේ උපදෙස් අනුගමනය කරන්න.", TamilTitle = "கனமழை எதிர்பார்க்கப்படுகிறது", TamilMessage = "மாதிரி அறிவிப்பு: பாதுகாப்பான இடத்தில் இருங்கள். உள்ளூர் அதிகாரிகளின் அறிவுறுத்தல்களைப் பின்பற்றுங்கள்.", Severity = "Warning", Area = "Kelani basin · demo", Authority = "Surakuma demo coordination team", ExpiresAt = DateTimeOffset.UtcNow.AddDays(30), Published = true });
        db.Add(new VolunteerTask { RequestId = food.Id, VolunteerId = volunteer.Id, Title = "Prepare household food pack delivery", RequiredSkill = "distribution", DueAt = DateTimeOffset.UtcNow.AddDays(1) });
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
    }
}
