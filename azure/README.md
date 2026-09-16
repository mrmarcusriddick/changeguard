> **Current deployment:** [F1 + PostgreSQL setup](POSTGRESQL.md). Paid B1ms PostgreSQL is now authorized. The previous Azure SQL free-only instructions below are historical.

# ChangeGuard on Azure Commercial

**Superseded by the free-only requirement.** Use [FREE-TIER.md](FREE-TIER.md). The paid bootstrap and legacy runtime deployment workflows are blocked. The instructions below are historical and must not be used to provision paid resources.

This is an additional deployment target for the existing prototype. The Azure build uses Next.js on Node 24, PostgreSQL, and App Service's Entra authentication. It does not deploy the Cloudflare Worker to Azure. Collectors remain explicitly simulated; connecting the Azure hosting subscription does **not** enable Microsoft Graph or infrastructure collection.

| Setting | Value |
| --- | --- |
| Cloud | Azure Commercial (`AzureCloud`) |
| Tenant | `a72c5ca4-2803-4603-b2ed-1d4e1a6db4f2` |
| Subscription | `a2e23015-1a59-4109-9126-cd464798993f` |
| GitHub repository | `mrmarcusriddick/changeguard` |
| Default region | `eastus` (override bootstrap's third argument) |
| Environments | `staging`, `production` |

## One-time setup

The following commands create billable resources. Each environment provisions an App Service B1 plan, Linux Node 24 app, PostgreSQL 16 B1ms server with 32 GiB storage and 14-day backups, and a private VNet/DNS connection. Staging and production have separate resource groups, databases, sign-in apps, and deployment identities. These starter SKUs have no zone-redundant high availability. Review the template/SKUs for your budget and availability target before running it.

1. Upload this source to the repository, preserving the workflows. Configure repository Actions to allow the pinned GitHub and Azure actions. Create GitHub environments named exactly `staging` and `production`, restricted to the `main` branch. **Require a reviewer and prevent self-review on production before enabling deployment.** Environment protection availability depends on the repository's GitHub plan; if required reviewers are unavailable, keep automated production deployment disabled until an equivalent enforced gate exists. Require both CI checks (`Validate and package`, `Validate Azure runtime`) in main's branch protection and disallow direct pushes.
2. Open Bash in Azure Commercial Cloud Shell from your tenant. The setup operator needs permission to create the resources, assign Azure roles, and create Entra app registrations/service principals. IDs alone do not grant those permissions. Clone the repository (or upload/unzip this source into Cloud Shell), then run from its root, choosing globally unique lowercase names:

   ```bash
   bash azure/bootstrap.sh staging changeguard-mr-stage eastus
   bash azure/bootstrap.sh production changeguard-mr-prod eastus
   ```

   If Cloud Shell is signed into a different tenant, sign into the supplied tenant first. The script selects `AzureCloud` and your subscription, verifies the tenant, generates distinct credentials without printing them, and creates GitHub OIDC trust. It refuses to overwrite an existing environment. If interrupted, inspect the resource group and Entra apps and resume the remaining steps deliberately; do not remove the rerun guard to reset working credentials.
3. For **each** GitHub environment, add its three printed values as environment **variables**: `AZURE_CLIENT_ID`, `AZURE_WEBAPP_NAME`, and `AZURE_RESOURCE_GROUP`. No Azure client secret or publish profile is stored in GitHub. The staging identity has Website Contributor only on the staging app; the production identity only on the production app. Neither pipeline identity provisions infrastructure or receives subscription-wide Contributor.
4. Merge the source into `main`. CI tests both hosting targets, compiles Bicep, runs real PostgreSQL API tests, builds the Azure standalone ZIP, and retains it for 30 days. A successful main push automatically deploys staging. Health checks require the expected source commit and database access, and verify anonymous workspace requests are rejected. Production then waits for its configured environment approval and deploys **the exact same ZIP**. No rebuild occurs during promotion.
5. Sign in to staging with your tenant account and create a change, analyze it, and save a plan before approving the first production deployment. Hosted Entra sign-in needs this initial end-to-end check; local tests cannot validate your app registration, tenant policy, or Azure permissions.

## Runtime and security boundaries

- Easy Auth requires authentication everywhere except `/api/health`. The app accepts only its configured tenant and uses `tenant ID:object ID` as the data owner. All users allowed into this single-tenant sign-in app can create their own workspace. Assign users/groups to the Enterprise Application if you need narrower admission. Shared team roles are not implemented.
- The Azure build replaces the Sites identity adapter; it never accepts `oai-authenticated-*` headers. Azure's `X-MS-CLIENT-PRINCIPAL` header is trusted **only behind enabled App Service Easy Auth**, which prevents external callers from setting it. Do not expose the Node server directly or disable Easy Auth.
- POST requests require the configured public `APP_ORIGIN`, rather than the reverse proxy's internal URL. If adding a custom domain, update this setting and the Entra callback URI together.
- PostgreSQL has no public endpoint and requires TLS with certificate validation. Migrations run inside the app's VNet at startup, use a cross-instance advisory lock, transact each migration, and reject edits to already-applied migrations. Migration failure prevents application startup and blocks promotion.
- This starter uses an environment-specific PostgreSQL administrator for startup migrations and runtime access. Before onboarding paying customers, separate the migration role from a restricted runtime role and manage credential rotation. Secrets are encrypted App Service settings and secure deployment parameters, not source files or GitHub secrets. Move them to Key Vault references if required by your operational policy. App Service configuration readers can access those settings.
- The sign-in app credential created by bootstrap expires after one year. Rotate it and update `MICROSOFT_PROVIDER_AUTHENTICATION_SECRET` before expiration. Rotate database credentials in PostgreSQL and `PGPASSWORD` together. Bootstrap is not a rotation tool.
- The anonymous health endpoint exposes only readiness and a commit identifier. It checks the database schema without returning data. It does not validate live collectors.
- Existing Sites data is not migrated. Azure starts with a new database and new Entra user IDs. No production changes are automatically executed by ChangeGuard.

## Rollback and operations

From GitHub Actions, run **Deploy Azure Commercial** manually on `main` and provide a previous successful main-push **ChangeGuard CI run ID** whose artifact is still retained. The selector verifies repository, workflow, branch, ancestry, run success, and artifact identity. The previous ZIP passes through staging and the same production approval. Download and retain approved artifacts in your long-term release process if you need rollback beyond 30 days.

Rollback redeploys application code; it does not undo database migrations. Use additive, backward-compatible migrations so a prior release can run against the current schema. A failed health check fails the workflow and does not automatically roll back a partially deployed production app. Use the known-good run for a compatible code rollback or deploy a forward fix. Restore PostgreSQL point-in-time backups to a separate server only through a reviewed recovery procedure; configure the app for the recovered server and validate before switching traffic.

Use App Service log streaming and deployment logs for initial troubleshooting. Configure Azure Monitor alerts, longer-term log retention, cost budgets, restore drills, and production database sizing before offering a paid service. This template does not claim those operational policies are already configured.

## Local verification

For this delivery, application lint/type checks, the nine existing tests, the Entra principal test, the standalone Azure build, and Bicep compilation passed locally. The real PostgreSQL integration test is configured as a required CI job but has not run in this workspace. No Azure resources have been provisioned, and no GitHub Actions deployment or hosted sign-in has been verified yet.

```bash
pnpm install --frozen-lockfile
pnpm lint:app
pnpm typecheck
pnpm test
# Use a disposable PostgreSQL database with a name ending in _test.
# The test drops/recreates its public schema.
PGHOST=localhost PGUSER=postgres PGPASSWORD=... PGDATABASE=changeguard_test pnpm test:azure
pnpm build:azure
az bicep build --file azure/infra/main.bicep --stdout > /dev/null
```

Azure build output is `artifacts/changeguard-azure.zip`. Run the build from a clean checkout; it refuses to reuse a prior staging build directory. The CI artifact embeds the source commit and has a SHA-256 manifest. This is an integrity check within the trusted GitHub run, not an independent artifact signature.

The ZIP contains a launcher and an inner runtime tarball. At startup the launcher extracts the tarball into a unique temporary directory, preserving pnpm's internal dependency links, then runs migrations and starts Next. Packaging rejects links outside the runtime and verifies migration dependencies in an extracted copy outside the checkout.

References: [App Service Node runtime](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs), [App Service identity headers](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-user-identities), [GitHub OIDC with Azure](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-azure), [Next standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [PostgreSQL infrastructure reference](https://learn.microsoft.com/en-us/azure/templates/microsoft.dbforpostgresql/2024-08-01/flexibleservers).
