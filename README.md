# Surakuma · සුරැකුම

Surakuma is a humanitarian aid coordination platform. Citizens can request help, find shelters, and track their requests. Response teams can review cases, allocate supplies, coordinate volunteers, and confirm delivery.

The frontend uses React, TypeScript, and Vite. The ASP.NET Core 10 API uses Entity Framework Core and SQL Server.

## Run locally on Windows

Install the **.NET 10 SDK**, **Node.js 24 with npm**, and **SQL Server Express LocalDB** with the default `MSSQLLocalDB` instance. Use a Windows account that can create a database on the instance. The first setup downloads NuGet and npm dependencies.

Clone this repository with Git or download and extract its source ZIP. Open PowerShell in the repository folder and run:

```powershell
sqllocaldb start MSSQLLocalDB
dotnet dev-certs https --trust

$env:ConnectionStrings__Default = 'Server=(localdb)\MSSQLLocalDB;Database=Surakuma;Trusted_Connection=True;TrustServerCertificate=True;Connect Timeout=10'
$env:Email__Provider = 'Capture'

.\scripts\Setup.ps1 -SqlServer '(localdb)\MSSQLLocalDB'
.\scripts\Start-Api.ps1
```

Setup installs dependencies, applies migrations, and seeds an empty development database. On later starts, set the same environment variables in the API terminal and run `Start-Api.ps1`. If you use a running `.\SQLEXPRESS` instance instead, use `.\scripts\Setup.ps1` and the default connection.

Leave the API running. Open a second PowerShell terminal in the repository folder and run:

```powershell
.\scripts\Start-Web.ps1
```

Open the [website](http://localhost:5173). Confirm that the [readiness endpoint](http://localhost:5173/api/v1/ready) returns HTTP 200. If it returns 503, check that SQL Server is running and that setup and the API use the same instance. The [Swagger UI](https://localhost:7043/swagger) shows the development API.

For a fresh development database, use `citizen@surakuma.test` to submit and track an aid request, or `admin@surakuma.test` to explore administration. Read the generated local password from the repository folder:

```powershell
(Get-Content .\backend\data\development-settings.json | ConvertFrom-Json).Seed.Password
```

The local walkthrough uses synthetic data, rule-based AI, and captured email. It runs without external API keys.
