CREATE TABLE entra_scans (
 id uuid PRIMARY KEY,
 tenant text NOT NULL,
 actor text NOT NULL,
 started timestamptz NOT NULL DEFAULT now(),
 completed timestamptz,
 status text NOT NULL CHECK (status IN ('running','succeeded','failed')),
 error_code text,
 message text,
 policies jsonb,
 baseline_id uuid REFERENCES entra_scans(id),
 findings jsonb,
 CHECK ((status='succeeded') = (policies IS NOT NULL AND findings IS NOT NULL))
);
CREATE UNIQUE INDEX entra_one_running_scan ON entra_scans(tenant) WHERE status='running';
CREATE INDEX entra_scan_history ON entra_scans(tenant,started DESC);
