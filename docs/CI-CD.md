# ChangeGuard delivery pipeline

For Azure Commercial, use [azure/README.md](../azure/README.md): it covers the additional runtime, infrastructure, and staging-to-production pipeline. The sections below describe the original Sites artifact/release path. Azure uses `azure-deploy.yml` and its own standalone package.

## What is automated

Pull requests, pushes to main, and manual CI runs install the pinned pnpm version and frozen lockfile, lint application and pipeline code, type-check, run tests, verify schema/migration drift, and build the production Worker. Passing runs retain a source ZIP, Sites deployment tarball, commit/migration manifest, and SHA-256 checksums for 30 days.

The release workflow promotes the **same artifact** from a successful main push. It does not rebuild. A separate read-only job validates repository, workflow, branch, event, conclusion, commit ancestry and artifact identity. Release identifiers are validated and passed through environment variables, never interpolated into shell code. PR code has no write token or deployment secrets. Actions are pinned to official repository commits and Dependabot proposes updates.

Release publication is continuous delivery of versioned artifacts, **not automatic deployment to the live site**. No supported GitHub Actions-to-Sites deployment credential/API is available in this project. The app relies on Sites authentication headers and Sites-owned D1. Do not use the generated placeholder Wrangler database ID as a production database or deploy this Worker publicly with trusted identity headers exposed.

## Enable GitHub

1. Upload the complete updated source, including `.github`, `.openai`, `tests`, and `scripts/ci`. v0.2 backend files must be included; the old prototype cannot run these tests.
2. Enable Actions. PR CI requires no configured secrets. Package installation needs access to npm and GitHub; it uses no private Work-mode scripts or caches.
3. Protect `main`: require a pull request, successful `Validate and package`, and up-to-date checks; disable force pushes/deletion. Configure these in repository rulesets; workflow files do not enforce branch protection by themselves.
4. Create the GitHub environment `release`. Restrict deployment branches to `main`; add required reviewers if available for your repository plan. Configure reviewers in GitHub: `environment: release` alone does not create an approval policy.
5. Protect `v*` tags against modification/deletion. The release workflow rejects an existing tag; it never overwrites a release. Repository administrators can still change these policies.

## Make a release

Merge the reviewed change to main and wait for its push CI run to pass. Copy that run's numeric ID from its Actions URL. Run **ChangeGuard Release** on `main`, enter the run ID and a new tag such as `v0.2.0`, and approve the environment if required. Download assets from the resulting GitHub Release. A failure or missing/expired artifact stops release publication. A partial release failure must be inspected before retrying; do not delete tags or clobber assets automatically.

## Sites publication handoff

Use the source ZIP and manifest to identify the exact commit. In a Sites-capable session, verify archive checksums, ensure the source is pushed to the existing Sites source repository, save that exact source version and bundle, then publish to the existing audience. Confirm terminal deployment success. Never report a GitHub release as a deployed application.

Sites applies committed Drizzle migrations before the Worker publication. Existing applied migrations must remain unchanged. Use additive migrations compatible with both the currently running and new code. Take a database recovery checkpoint through the hosting provider before risky schema changes. The initial migration is schema-only; future migrations need explicit review.

Rollback: choose a prior validated artifact/source version and publish it through Sites only after confirming compatibility with the current schema. Code rollback does not undo database migrations. If compatibility is uncertain, stop and forward-fix; do not automatically roll back schema or delete user data.

## Complete automated runtime deployment

This requires a supported CI publishing integration for Sites, or an explicitly selected alternate host with a real database binding and server-side authentication configured. No deployment credentials are requested or stored by these workflows. The existing private site remains the runtime until that decision is made.

## Local verification

Use Node 24 and pnpm 11.25.0. Run `pnpm install --frozen-lockfile`, `pnpm lint:app`, `pnpm typecheck`, `pnpm test`, `pnpm db:generate` (confirm no migration drift), and `pnpm build`. Commit all source changes, then run `pnpm ci:package` from a clean checkout. Output is in ignored `artifacts/`; move any previous output before packaging again.

API tests run the actual route handler against SQLite with a D1-compatible adapter and mocked authenticated identity. They do not validate browser behavior, live Cloudflare D1 or the external identity dispatcher. Hosted smoke testing remains part of the publication handoff.

## References

- https://docs.github.com/en/actions/tutorials/store-and-share-data
- https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
