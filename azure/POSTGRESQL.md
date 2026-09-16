# F1 web hosting with Azure PostgreSQL

This is the current deployment path. The owner authorized a small paid PostgreSQL database on 2026-09-16. Azure SQL is no longer provisioned by the infrastructure workflow. Old `free.bicep` and `main.bicep` are historical; neither is deployed by this workflow.

## Fixed cost profile

- Existing `changeguard-mr-free` web app and `changeguard-mr-free-free` plan: Linux F1 Free.
- PostgreSQL 16 Flexible Server `changeguard-mr-free-pg`: Burstable Standard_B1ms, 32 GB storage, autogrowth disabled, 7-day local backups, HA disabled.
- PostgreSQL is billed unless the subscription has an applicable free offer. This is not a zero-cost deployment or a hard monthly spending cap. Compute, storage, excess backup storage and applicable transfer charges can apply. Check the region-specific estimate in the Azure pricing calculator before running provision.
- No paid web plan, private endpoints, private DNS, NAT gateway, second environment, or geo-redundant backups are created.
- PostgreSQL defaults to East US independently of the resource group's location. SQL's region restriction does not establish PostgreSQL availability. A region input permits an explicit change if PostgreSQL is also restricted; an existing PostgreSQL server cannot be moved by changing this input.

## One-time setup

1. In subscription Resource providers, register `Microsoft.DBforPostgreSQL`. Existing `Microsoft.Web` registration and resource-group Contributor assignment remain in use. The pipeline does not elevate roles or register providers itself.
2. Create a single-tenant Entra app registration for **ChangeGuard sign-in**, separate from the GitHub provisioning identity. Add a **Web** redirect URI `https://changeguard-mr-free.azurewebsites.net/.auth/login/aad/callback`. Create a client secret; follow the App Service Microsoft identity provider setup for ID tokens. Keep its expiration on your operational calendar.
3. In GitHub Settings → Environments → `azure-infrastructure`, add these **secrets**, not workflow inputs or source files:

| Secret | Value |
|---|---|
| `CG_DATABASE_PASSWORD` | Strong generated password, 16–128 characters, at least three character classes; keep stable across infrastructure runs |
| `CG_AUTH_CLIENT_ID` | Application/client ID of the ChangeGuard sign-in app |
| `CG_AUTH_CLIENT_SECRET` | Client secret **value** for that sign-in app |

Existing `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID` continue to identify the OIDC provisioning connection. No SQL admin UPN or object ID is required.

4. Start a **new** `Azure PostgreSQL infrastructure` run on `main`, operation `provision`. Pushes run checks only. A successful run provisions the database and configures TLS-required app connections with a firewall limited to the app's current outbound IPv4 addresses. These are shared App Service egress addresses, not an exclusive network identity. No all-Azure exception is enabled. Reprovision if outbound addresses change. The app stays stopped until delivery.
5. After provisioning succeeds, set repository **Actions variable** `AZURE_POSTGRES_READY=true`. Start `Deploy Azure Commercial` with the successful **main-branch ChangeGuard CI run ID**. Subsequent successful main CI runs deploy automatically. This reuses the `azure-infrastructure` environment and its working OIDC trust; no extra staging identity or paid staging resources are needed.

## Delivery and recovery

CI tests the PostgreSQL adapter with PostgreSQL 16, compiles the new template, tests the cost guards, and produces an immutable package. Delivery validates the source CI run, checksum, commit marker, Azure account, F1 plan, B1ms database and Entra configuration, then starts/deploys the app and checks database health, release identity and authentication.

Database migrations run at app startup. Initial MVP uses the database administrator account for migration and runtime; a separate least-privilege runtime role remains production hardening work. App Service F1 has limited resources and no production SLA. Entra configuration and actual Azure deployment still require end-to-end verification.

An infrastructure rerun stops the web app while reapplying configuration; run package delivery afterward. Deployments use Incremental mode and do not delete SQL resources from earlier partial attempts. Inspect those separately before any cleanup. No SQL data migration is performed. Rollback of application code uses an earlier retained successful CI run; database schema rollback is not automatic. Set `AZURE_POSTGRES_READY=false` to pause automatic releases.

References: [PostgreSQL pricing](https://azure.microsoft.com/pricing/details/postgresql/flexible-server/), [App Service Microsoft sign-in](https://learn.microsoft.com/azure/app-service/configure-authentication-provider-aad), [App Service outbound IPs](https://learn.microsoft.com/azure/app-service/overview-inbound-outbound-ips).
