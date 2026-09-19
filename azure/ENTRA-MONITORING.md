# Entra Conditional Access monitoring

Open `/entra` from the ChangeGuard workspace. This release reads the deployed commercial tenant `a72c5ca4-2803-4603-b2ed-1d4e1a6db4f2` through the App Service system-assigned managed identity. No client secret is collected or stored for the connector. Graph receives GET requests only; the application cannot write policies with this permission.

## One-time permission grant

An Entra administrator authorized to grant Microsoft Graph application permissions must grant **Policy.Read.All** to the **App Service managed identity**. This is separate from the sign-in app registration and the GitHub deployment identity. Subscription Contributor alone does not grant this directory permission.

In Azure Cloud Shell (Bash), from a checkout of this repository:

```bash
az account set --subscription a2e23015-1a59-4109-9126-cd464798993f
python3 scripts/ci/grant-entra-reader.py
python3 scripts/ci/grant-entra-reader.py --apply
```

The first command previews the exact identity; the second grants just the named Graph application role. The script refuses a different tenant/subscription and skips an existing grant. Graph role changes may take time to propagate because managed identity tokens are cached. A 403 can also reflect tenant licensing or access restrictions. No directory write permission is assigned to the runtime app.

Initial monitoring access is restricted server-side to the owner-supplied object ID `f749cd19-7e0c-4359-8c31-300ebea9655d` in this tenant. App setting `CG_ENTRA_OPERATOR_IDS` can replace that allowlist with comma-separated tenant user object IDs. Blank denies everyone. Sign-in alone does not grant monitoring access. Operators share this tenant's monitoring history; the mock workspace retains its existing per-user ownership.

## Operation and interpretation

1. Select **Connect and capture baseline**. The first complete successful scan stores the initial baseline and reports zero change alerts, including for an empty tenant.
2. Select **Scan for changes** after a configuration change. Each scan compares with the most recent successful snapshot; failed scans cannot replace it. Baseline and subsequent snapshots are retained in PostgreSQL.
3. Review additions, deletions, field-level differences, and deterministic risk explanations. High priority includes stopped enforcement, expanded exclusions, and grant-control changes. This is a review priority, not a claim that MFA is bypassed; other policies may still apply.
4. Scan history records the initiating user, start/end timestamps, success/failure, and safe error codes. The UI lists the most recent 30 scans; older snapshots remain in the database and are available by their scan IDs.

Scans are manual, with a one-minute cooldown and a database advisory lock to prevent overlap. Partial pagination, duplicate/malformed policies, timeouts, Graph 403/429/5xx, and token failures produce failures rather than false deletion alerts. A worker termination is reconciled as interrupted on the next scan. Successful snapshots and findings are committed in one database statement. The additive `002-entra-monitor.sql` migration is checksum-verified and transactionally applied by startup; existing workspace data is untouched.

Not included: scheduled polling, alerts, approval/remediation, multi-tenant onboarding, directory membership resolution, affected-user counts, named-location or authentication-strength definition monitoring, and changes that happen entirely between scans. Snapshot comparisons are not Graph audit events and do not identify who changed a policy. The initial baseline is a reference, not a security-approved configuration. An empty successful scan says there were zero policies returned, not that the tenant is secure.

## Validation

CI tests ordering/metadata normalization; policy change priorities; read-only Graph pagination; malformed/partial/denied/throttled collection failures; operator and tenant guards; PostgreSQL baseline retention after failure, cooldown, concurrent-scan rejection, migration replay, and existing workspace regression tests. The Azure build includes `/entra` and `/api/entra`; the Sites build is unchanged. Live collection is only verified after the permission grant and a successful real tenant scan.

Sources:
- https://learn.microsoft.com/en-us/graph/api/conditionalaccessroot-list-policies?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity
- https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/assign-app-role-managed-identity-powershell
