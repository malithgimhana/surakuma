param(
    [Parameter(Mandatory)][Guid]$UserId,
    [ValidatePattern('^Surakuma(?:_[A-Za-z0-9]+)*$')][string]$DatabaseName = 'Surakuma'
)
$ErrorActionPreference = 'Stop'
# Explicit operator-only bootstrap for an existing account. Never called by the API.
$sql = @"
SET QUOTED_IDENTIFIER ON; SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
BEGIN TRANSACTION;
IF (SELECT COUNT(*) FROM AspNetUsers WHERE IsSystemAdministrator=1 AND Disabled=0) <> 1 THROW 51000,'Bootstrap is allowed only with exactly one active system administrator.',1;
IF NOT EXISTS(SELECT 1 FROM AspNetUsers WHERE Id='$UserId' AND Disabled=0) THROW 51000,'Choose an existing enabled account.',1;
IF EXISTS(SELECT 1 FROM AspNetUsers WHERE Id='$UserId' AND IsSystemAdministrator=1) THROW 51000,'Target already has system administrator access.',1;
DECLARE @now datetimeoffset=SYSDATETIMEOFFSET();
UPDATE AspNetUsers SET IsSystemAdministrator=1,SecurityStamp=CONVERT(nvarchar(36),NEWID()),ConcurrencyStamp=CONVERT(nvarchar(36),NEWID()) WHERE Id='$UserId';
UPDATE RefreshSession SET Revoked=1,UpdatedAt=@now WHERE UserId='$UserId' AND Revoked=0;
INSERT AuditEvent(Id,ActorId,Action,EntityType,EntityId,Detail,CreatedAt,UpdatedAt) VALUES(NEWID(),'LocalSystemOperator','SecondAdministratorBootstrapped','User','$UserId','Explicit operator bootstrap for existing user $UserId',@now,@now);
COMMIT;
"@
& sqlcmd -I -S '(localdb)\MSSQLLocalDB' -E -b -d $DatabaseName -Q $sql
if ($LASTEXITCODE) { throw 'Bootstrap failed; inspect the SQL error.' }
Write-Output 'Second administrator provisioned and sessions invalidated. Subsequent global grants require approval.'
