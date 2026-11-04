IF OBJECT_ID(N'[__EFMigrationsHistory]') IS NULL
BEGIN
    CREATE TABLE [__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [AspNetRoles] (
        [Id] nvarchar(450) NOT NULL,
        [Name] nvarchar(256) NULL,
        [NormalizedName] nvarchar(256) NULL,
        [ConcurrencyStamp] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetRoles] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [AspNetUsers] (
        [Id] nvarchar(450) NOT NULL,
        [DisplayName] nvarchar(max) NOT NULL,
        [Language] nvarchar(max) NOT NULL,
        [UserName] nvarchar(256) NULL,
        [NormalizedUserName] nvarchar(256) NULL,
        [Email] nvarchar(256) NULL,
        [NormalizedEmail] nvarchar(256) NULL,
        [EmailConfirmed] bit NOT NULL,
        [PasswordHash] nvarchar(max) NULL,
        [SecurityStamp] nvarchar(max) NULL,
        [ConcurrencyStamp] nvarchar(max) NULL,
        [PhoneNumber] nvarchar(max) NULL,
        [PhoneNumberConfirmed] bit NOT NULL,
        [TwoFactorEnabled] bit NOT NULL,
        [LockoutEnd] datetimeoffset NULL,
        [LockoutEnabled] bit NOT NULL,
        [AccessFailedCount] int NOT NULL,
        CONSTRAINT [PK_AspNetUsers] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [AuditEvent] (
        [Id] uniqueidentifier NOT NULL,
        [ActorId] nvarchar(450) NOT NULL,
        [Action] nvarchar(4000) NOT NULL,
        [EntityType] nvarchar(4000) NOT NULL,
        [EntityId] uniqueidentifier NOT NULL,
        [Detail] nvarchar(4000) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_AuditEvent] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [Crisis] (
        [Id] uniqueidentifier NOT NULL,
        [Name] nvarchar(4000) NOT NULL,
        [Type] nvarchar(4000) NOT NULL,
        [District] nvarchar(4000) NOT NULL,
        [Active] bit NOT NULL,
        [Latitude] float NOT NULL,
        [Longitude] float NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Crisis] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [NotificationDelivery] (
        [Id] uniqueidentifier NOT NULL,
        [EventId] uniqueidentifier NOT NULL,
        [RecipientId] nvarchar(450) NOT NULL,
        [Provider] nvarchar(4000) NOT NULL,
        [State] nvarchar(4000) NOT NULL,
        [ProviderReference] nvarchar(4000) NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_NotificationDelivery] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [Organisation] (
        [Id] uniqueidentifier NOT NULL,
        [Name] nvarchar(4000) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Organisation] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [OutboxMessage] (
        [Id] uniqueidentifier NOT NULL,
        [UserId] nvarchar(450) NOT NULL,
        [RequestId] uniqueidentifier NOT NULL,
        [Message] nvarchar(4000) NOT NULL,
        [State] nvarchar(4000) NOT NULL,
        [Attempts] int NOT NULL,
        [NextAttemptAt] datetimeoffset NOT NULL,
        [LastError] nvarchar(4000) NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_OutboxMessage] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [AspNetRoleClaims] (
        [Id] int NOT NULL IDENTITY,
        [RoleId] nvarchar(450) NOT NULL,
        [ClaimType] nvarchar(max) NULL,
        [ClaimValue] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetRoleClaims] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_AspNetRoleClaims_AspNetRoles_RoleId] FOREIGN KEY ([RoleId]) REFERENCES [AspNetRoles] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [AspNetUserClaims] (
        [Id] int NOT NULL IDENTITY,
        [UserId] nvarchar(450) NOT NULL,
        [ClaimType] nvarchar(max) NULL,
        [ClaimValue] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetUserClaims] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_AspNetUserClaims_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [AspNetUserLogins] (
        [LoginProvider] nvarchar(450) NOT NULL,
        [ProviderKey] nvarchar(450) NOT NULL,
        [ProviderDisplayName] nvarchar(max) NULL,
        [UserId] nvarchar(450) NOT NULL,
        CONSTRAINT [PK_AspNetUserLogins] PRIMARY KEY ([LoginProvider], [ProviderKey]),
        CONSTRAINT [FK_AspNetUserLogins_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [AspNetUserRoles] (
        [UserId] nvarchar(450) NOT NULL,
        [RoleId] nvarchar(450) NOT NULL,
        CONSTRAINT [PK_AspNetUserRoles] PRIMARY KEY ([UserId], [RoleId]),
        CONSTRAINT [FK_AspNetUserRoles_AspNetRoles_RoleId] FOREIGN KEY ([RoleId]) REFERENCES [AspNetRoles] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_AspNetUserRoles_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [AspNetUserTokens] (
        [UserId] nvarchar(450) NOT NULL,
        [LoginProvider] nvarchar(450) NOT NULL,
        [Name] nvarchar(450) NOT NULL,
        [Value] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetUserTokens] PRIMARY KEY ([UserId], [LoginProvider], [Name]),
        CONSTRAINT [FK_AspNetUserTokens_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [Household] (
        [Id] uniqueidentifier NOT NULL,
        [UserId] nvarchar(450) NOT NULL,
        [Size] int NOT NULL,
        [AccessibilityNeeds] nvarchar(4000) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Household] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Household_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [Notification] (
        [Id] uniqueidentifier NOT NULL,
        [UserId] nvarchar(450) NOT NULL,
        [EventId] uniqueidentifier NOT NULL,
        [RequestId] uniqueidentifier NULL,
        [Message] nvarchar(4000) NOT NULL,
        [Read] bit NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Notification] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Notification_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [RefreshSession] (
        [Id] uniqueidentifier NOT NULL,
        [UserId] nvarchar(450) NOT NULL,
        [TokenHash] nvarchar(64) NOT NULL,
        [ExpiresAt] datetimeoffset NOT NULL,
        [Revoked] bit NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_RefreshSession] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_RefreshSession_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [CrisisAssignment] (
        [Id] uniqueidentifier NOT NULL,
        [CrisisId] uniqueidentifier NOT NULL,
        [UserId] nvarchar(450) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_CrisisAssignment] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_CrisisAssignment_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_CrisisAssignment_Crisis_CrisisId] FOREIGN KEY ([CrisisId]) REFERENCES [Crisis] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [OperationalArea] (
        [Id] uniqueidentifier NOT NULL,
        [CrisisId] uniqueidentifier NOT NULL,
        [Name] nvarchar(4000) NOT NULL,
        [GeoJson] nvarchar(4000) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_OperationalArea] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_OperationalArea_Crisis_CrisisId] FOREIGN KEY ([CrisisId]) REFERENCES [Crisis] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [PublicAlert] (
        [Id] uniqueidentifier NOT NULL,
        [CrisisId] uniqueidentifier NOT NULL,
        [Title] nvarchar(4000) NOT NULL,
        [Message] nvarchar(4000) NOT NULL,
        [SinhalaTitle] nvarchar(4000) NOT NULL,
        [SinhalaMessage] nvarchar(4000) NOT NULL,
        [TamilTitle] nvarchar(4000) NOT NULL,
        [TamilMessage] nvarchar(4000) NOT NULL,
        [Severity] nvarchar(4000) NOT NULL,
        [Area] nvarchar(4000) NOT NULL,
        [Authority] nvarchar(4000) NOT NULL,
        [ExpiresAt] datetimeoffset NOT NULL,
        [Published] bit NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_PublicAlert] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_PublicAlert_Crisis_CrisisId] FOREIGN KEY ([CrisisId]) REFERENCES [Crisis] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [AssistanceRequest] (
        [Id] uniqueidentifier NOT NULL,
        [Reference] nvarchar(30) NOT NULL,
        [CitizenId] nvarchar(450) NOT NULL,
        [CrisisId] uniqueidentifier NOT NULL,
        [OrganisationId] uniqueidentifier NOT NULL,
        [Category] nvarchar(50) NOT NULL,
        [Priority] nvarchar(50) NOT NULL,
        [Description] nvarchar(4000) NOT NULL,
        [LocationText] nvarchar(4000) NOT NULL,
        [Latitude] float NULL,
        [Longitude] float NULL,
        [HouseholdSize] int NOT NULL,
        [AccessibilityNeeds] nvarchar(4000) NOT NULL,
        [Quantity] decimal(18,2) NOT NULL,
        [DeliveredQuantity] decimal(18,2) NOT NULL,
        [Status] nvarchar(50) NOT NULL,
        [Escalated] bit NOT NULL,
        [Synthetic] bit NOT NULL,
        [SubmissionKey] nvarchar(100) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_AssistanceRequest] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Request_Quantity] CHECK ([Quantity] > 0 AND [DeliveredQuantity] >= 0 AND [DeliveredQuantity] <= [Quantity] AND [HouseholdSize] >= 1),
        CONSTRAINT [FK_AssistanceRequest_AspNetUsers_CitizenId] FOREIGN KEY ([CitizenId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_AssistanceRequest_Crisis_CrisisId] FOREIGN KEY ([CrisisId]) REFERENCES [Crisis] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_AssistanceRequest_Organisation_OrganisationId] FOREIGN KEY ([OrganisationId]) REFERENCES [Organisation] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [Membership] (
        [Id] uniqueidentifier NOT NULL,
        [UserId] nvarchar(450) NOT NULL,
        [OrganisationId] uniqueidentifier NOT NULL,
        [Role] nvarchar(50) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Membership] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Membership_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_Membership_Organisation_OrganisationId] FOREIGN KEY ([OrganisationId]) REFERENCES [Organisation] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [Resource] (
        [Id] uniqueidentifier NOT NULL,
        [OrganisationId] uniqueidentifier NOT NULL,
        [Name] nvarchar(4000) NOT NULL,
        [Category] nvarchar(50) NOT NULL,
        [Unit] nvarchar(4000) NOT NULL,
        [Stock] decimal(18,2) NOT NULL,
        [Reserved] decimal(18,2) NOT NULL,
        [LocationText] nvarchar(4000) NOT NULL,
        [Latitude] float NOT NULL,
        [Longitude] float NOT NULL,
        [Suitability] nvarchar(4000) NOT NULL,
        [TransportAvailable] bit NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Resource] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Resource_Stock] CHECK ([Stock] >= 0 AND [Reserved] >= 0 AND [Reserved] <= [Stock]),
        CONSTRAINT [FK_Resource_Organisation_OrganisationId] FOREIGN KEY ([OrganisationId]) REFERENCES [Organisation] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [Shelter] (
        [Id] uniqueidentifier NOT NULL,
        [OrganisationId] uniqueidentifier NOT NULL,
        [Name] nvarchar(4000) NOT NULL,
        [Address] nvarchar(4000) NOT NULL,
        [Latitude] float NOT NULL,
        [Longitude] float NOT NULL,
        [Capacity] int NOT NULL,
        [Reserved] int NOT NULL,
        [Occupancy] int NOT NULL,
        [Accessible] bit NOT NULL,
        [Open] bit NOT NULL,
        [Facilities] nvarchar(4000) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Shelter] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Shelter_Capacity] CHECK ([Capacity] >= 1 AND [Reserved] >= 0 AND [Occupancy] >= 0 AND [Reserved] + [Occupancy] <= [Capacity]),
        CONSTRAINT [FK_Shelter_Organisation_OrganisationId] FOREIGN KEY ([OrganisationId]) REFERENCES [Organisation] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [VolunteerProfile] (
        [Id] uniqueidentifier NOT NULL,
        [UserId] nvarchar(450) NOT NULL,
        [OrganisationId] uniqueidentifier NOT NULL,
        [Skills] nvarchar(4000) NOT NULL,
        [Availability] nvarchar(4000) NOT NULL,
        [Verified] bit NOT NULL,
        [Available] bit NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_VolunteerProfile] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_VolunteerProfile_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_VolunteerProfile_Organisation_OrganisationId] FOREIGN KEY ([OrganisationId]) REFERENCES [Organisation] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [Attachment] (
        [Id] uniqueidentifier NOT NULL,
        [RequestId] uniqueidentifier NOT NULL,
        [StoredName] nvarchar(4000) NOT NULL,
        [OriginalName] nvarchar(4000) NOT NULL,
        [ContentType] nvarchar(4000) NOT NULL,
        [Size] bigint NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Attachment] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Attachment_AssistanceRequest_RequestId] FOREIGN KEY ([RequestId]) REFERENCES [AssistanceRequest] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [CaseShare] (
        [Id] uniqueidentifier NOT NULL,
        [RequestId] uniqueidentifier NOT NULL,
        [OrganisationId] uniqueidentifier NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_CaseShare] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_CaseShare_AssistanceRequest_RequestId] FOREIGN KEY ([RequestId]) REFERENCES [AssistanceRequest] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_CaseShare_Organisation_OrganisationId] FOREIGN KEY ([OrganisationId]) REFERENCES [Organisation] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [Feedback] (
        [Id] uniqueidentifier NOT NULL,
        [RequestId] uniqueidentifier NOT NULL,
        [UserId] nvarchar(450) NOT NULL,
        [Rating] int NOT NULL,
        [Received] bit NOT NULL,
        [Problem] bit NOT NULL,
        [Comment] nvarchar(4000) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Feedback] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Feedback_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_Feedback_AssistanceRequest_RequestId] FOREIGN KEY ([RequestId]) REFERENCES [AssistanceRequest] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [PotentialDuplicate] (
        [Id] uniqueidentifier NOT NULL,
        [RequestId] uniqueidentifier NOT NULL,
        [CandidateId] uniqueidentifier NOT NULL,
        [Similarity] float NOT NULL,
        [State] nvarchar(4000) NOT NULL,
        [Reason] nvarchar(4000) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_PotentialDuplicate] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_PotentialDuplicate_AssistanceRequest_CandidateId] FOREIGN KEY ([CandidateId]) REFERENCES [AssistanceRequest] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_PotentialDuplicate_AssistanceRequest_RequestId] FOREIGN KEY ([RequestId]) REFERENCES [AssistanceRequest] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [Recommendation] (
        [Id] uniqueidentifier NOT NULL,
        [RequestId] uniqueidentifier NOT NULL,
        [Category] nvarchar(50) NOT NULL,
        [Priority] nvarchar(50) NOT NULL,
        [Explanation] nvarchar(4000) NOT NULL,
        [Provider] nvarchar(4000) NOT NULL,
        [Model] nvarchar(4000) NOT NULL,
        [Confidence] float NULL,
        [ConfidenceKind] nvarchar(4000) NOT NULL,
        [Fallback] bit NOT NULL,
        [ReviewState] nvarchar(4000) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_Recommendation] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Recommendation_AssistanceRequest_RequestId] FOREIGN KEY ([RequestId]) REFERENCES [AssistanceRequest] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [RequestHistory] (
        [Id] uniqueidentifier NOT NULL,
        [RequestId] uniqueidentifier NOT NULL,
        [ActorId] nvarchar(450) NOT NULL,
        [Status] nvarchar(4000) NOT NULL,
        [Note] nvarchar(4000) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_RequestHistory] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_RequestHistory_AssistanceRequest_RequestId] FOREIGN KEY ([RequestId]) REFERENCES [AssistanceRequest] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [ResourceAllocation] (
        [Id] uniqueidentifier NOT NULL,
        [RequestId] uniqueidentifier NOT NULL,
        [ResourceId] uniqueidentifier NOT NULL,
        [Quantity] decimal(18,2) NOT NULL,
        [Status] nvarchar(50) NOT NULL,
        [ApprovedBy] nvarchar(450) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_ResourceAllocation] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_ResourceAllocation_AssistanceRequest_RequestId] FOREIGN KEY ([RequestId]) REFERENCES [AssistanceRequest] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_ResourceAllocation_Resource_ResourceId] FOREIGN KEY ([ResourceId]) REFERENCES [Resource] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [StockMovement] (
        [Id] uniqueidentifier NOT NULL,
        [ResourceId] uniqueidentifier NOT NULL,
        [Quantity] decimal(18,2) NOT NULL,
        [Kind] nvarchar(4000) NOT NULL,
        [ActorId] nvarchar(450) NOT NULL,
        [Note] nvarchar(4000) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_StockMovement] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_StockMovement_Resource_ResourceId] FOREIGN KEY ([ResourceId]) REFERENCES [Resource] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [ShelterAllocation] (
        [Id] uniqueidentifier NOT NULL,
        [ShelterId] uniqueidentifier NOT NULL,
        [RequestId] uniqueidentifier NOT NULL,
        [People] int NOT NULL,
        [Status] nvarchar(50) NOT NULL,
        [ApprovedBy] nvarchar(450) NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_ShelterAllocation] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_ShelterAllocation_AssistanceRequest_RequestId] FOREIGN KEY ([RequestId]) REFERENCES [AssistanceRequest] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_ShelterAllocation_Shelter_ShelterId] FOREIGN KEY ([ShelterId]) REFERENCES [Shelter] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [VolunteerTask] (
        [Id] uniqueidentifier NOT NULL,
        [RequestId] uniqueidentifier NOT NULL,
        [VolunteerId] uniqueidentifier NOT NULL,
        [Title] nvarchar(4000) NOT NULL,
        [RequiredSkill] nvarchar(4000) NOT NULL,
        [Note] nvarchar(4000) NOT NULL,
        [Status] nvarchar(50) NOT NULL,
        [DueAt] datetimeoffset NOT NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_VolunteerTask] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_VolunteerTask_AssistanceRequest_RequestId] FOREIGN KEY ([RequestId]) REFERENCES [AssistanceRequest] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_VolunteerTask_VolunteerProfile_VolunteerId] FOREIGN KEY ([VolunteerId]) REFERENCES [VolunteerProfile] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE TABLE [HumanDecision] (
        [Id] uniqueidentifier NOT NULL,
        [RecommendationId] uniqueidentifier NOT NULL,
        [RequestId] uniqueidentifier NOT NULL,
        [ActorId] nvarchar(450) NOT NULL,
        [Action] nvarchar(4000) NOT NULL,
        [Reason] nvarchar(4000) NOT NULL,
        [FinalPriority] int NULL,
        [CreatedAt] datetimeoffset NOT NULL,
        [UpdatedAt] datetimeoffset NOT NULL,
        [Version] rowversion NOT NULL,
        CONSTRAINT [PK_HumanDecision] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_HumanDecision_AssistanceRequest_RequestId] FOREIGN KEY ([RequestId]) REFERENCES [AssistanceRequest] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_HumanDecision_Recommendation_RecommendationId] FOREIGN KEY ([RecommendationId]) REFERENCES [Recommendation] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_AspNetRoleClaims_RoleId] ON [AspNetRoleClaims] ([RoleId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [RoleNameIndex] ON [AspNetRoles] ([NormalizedName]) WHERE [NormalizedName] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_AspNetUserClaims_UserId] ON [AspNetUserClaims] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_AspNetUserLogins_UserId] ON [AspNetUserLogins] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_AspNetUserRoles_RoleId] ON [AspNetUserRoles] ([RoleId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [EmailIndex] ON [AspNetUsers] ([NormalizedEmail]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [UserNameIndex] ON [AspNetUsers] ([NormalizedUserName]) WHERE [NormalizedUserName] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE UNIQUE INDEX [IX_AssistanceRequest_CitizenId_SubmissionKey] ON [AssistanceRequest] ([CitizenId], [SubmissionKey]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_AssistanceRequest_CrisisId_Status_Priority] ON [AssistanceRequest] ([CrisisId], [Status], [Priority]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_AssistanceRequest_OrganisationId] ON [AssistanceRequest] ([OrganisationId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE UNIQUE INDEX [IX_AssistanceRequest_Reference] ON [AssistanceRequest] ([Reference]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_Attachment_RequestId] ON [Attachment] ([RequestId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_CaseShare_OrganisationId] ON [CaseShare] ([OrganisationId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE UNIQUE INDEX [IX_CaseShare_RequestId_OrganisationId] ON [CaseShare] ([RequestId], [OrganisationId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE UNIQUE INDEX [IX_CrisisAssignment_CrisisId_UserId] ON [CrisisAssignment] ([CrisisId], [UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_CrisisAssignment_UserId] ON [CrisisAssignment] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_Feedback_RequestId] ON [Feedback] ([RequestId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_Feedback_UserId] ON [Feedback] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Household_UserId] ON [Household] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_HumanDecision_RecommendationId] ON [HumanDecision] ([RecommendationId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_HumanDecision_RequestId] ON [HumanDecision] ([RequestId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_Membership_OrganisationId] ON [Membership] ([OrganisationId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Membership_UserId_OrganisationId_Role] ON [Membership] ([UserId], [OrganisationId], [Role]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Notification_EventId_UserId] ON [Notification] ([EventId], [UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_Notification_UserId] ON [Notification] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE UNIQUE INDEX [IX_NotificationDelivery_EventId_RecipientId] ON [NotificationDelivery] ([EventId], [RecipientId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_OperationalArea_CrisisId] ON [OperationalArea] ([CrisisId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_OutboxMessage_State_NextAttemptAt] ON [OutboxMessage] ([State], [NextAttemptAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_PotentialDuplicate_CandidateId] ON [PotentialDuplicate] ([CandidateId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE UNIQUE INDEX [IX_PotentialDuplicate_RequestId_CandidateId] ON [PotentialDuplicate] ([RequestId], [CandidateId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_PublicAlert_CrisisId] ON [PublicAlert] ([CrisisId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_Recommendation_RequestId] ON [Recommendation] ([RequestId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE UNIQUE INDEX [IX_RefreshSession_TokenHash] ON [RefreshSession] ([TokenHash]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_RefreshSession_UserId] ON [RefreshSession] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_RequestHistory_RequestId] ON [RequestHistory] ([RequestId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_Resource_OrganisationId] ON [Resource] ([OrganisationId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_ResourceAllocation_RequestId] ON [ResourceAllocation] ([RequestId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_ResourceAllocation_ResourceId] ON [ResourceAllocation] ([ResourceId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_Shelter_OrganisationId] ON [Shelter] ([OrganisationId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_ShelterAllocation_RequestId] ON [ShelterAllocation] ([RequestId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_ShelterAllocation_ShelterId] ON [ShelterAllocation] ([ShelterId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_StockMovement_ResourceId] ON [StockMovement] ([ResourceId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_VolunteerProfile_OrganisationId] ON [VolunteerProfile] ([OrganisationId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE UNIQUE INDEX [IX_VolunteerProfile_UserId] ON [VolunteerProfile] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_VolunteerTask_RequestId] ON [VolunteerTask] ([RequestId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    CREATE INDEX [IX_VolunteerTask_VolunteerId] ON [VolunteerTask] ([VolunteerId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093126_InitialSchema'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261019093126_InitialSchema', N'10.0.6');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093803_LocalisedNotifications'
)
BEGIN
    ALTER TABLE [OutboxMessage] ADD [SinhalaMessage] nvarchar(4000) NOT NULL DEFAULT N'';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093803_LocalisedNotifications'
)
BEGIN
    ALTER TABLE [OutboxMessage] ADD [TamilMessage] nvarchar(4000) NOT NULL DEFAULT N'';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093803_LocalisedNotifications'
)
BEGIN
    ALTER TABLE [Notification] ADD [SinhalaMessage] nvarchar(4000) NOT NULL DEFAULT N'';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093803_LocalisedNotifications'
)
BEGIN
    ALTER TABLE [Notification] ADD [TamilMessage] nvarchar(4000) NOT NULL DEFAULT N'';
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261019093803_LocalisedNotifications'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261019093803_LocalisedNotifications', N'10.0.6');
END;

COMMIT;
GO

