using System.ComponentModel.DataAnnotations;

namespace Surakuma.Domain;

public sealed record CitizenSupplyItem(
    [Required, MaxLength(120)] string Item,
    [Range(typeof(decimal), "0.01", "100000")] decimal Quantity,
    [Required, MaxLength(32)] string Unit);

public sealed record CitizenIntake(
    [MaxLength(40)] string? Need = null,
    [MaxLength(40)] string? Timing = null,
    bool YoungOrPregnant = false,
    bool OlderIllOrDisabled = false,
    bool CutOff = false,
    [MaxLength(100)] string? MedicineName = null,
    [MaxLength(20)] string? Danger = null,
    [MaxLength(20)] string? SafeTonight = null,
    bool StepFree = false,
    bool AccessibleToilet = false,
    bool CaregiverSpace = false,
    [MaxLength(20)] string? TravelHelp = null,
    [MaxLength(40)] string? VehicleSupport = null,
    [MaxLength(40)] string? AccessService = null,
    [MaxLength(500)] string? Destination = null,
    [MinLength(1), MaxLength(4)] CitizenSupplyItem[]? SupplyItems = null);
