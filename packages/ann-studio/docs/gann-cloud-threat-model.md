---
version: "0.1.0"
created_at: "2026-08-14T00:00:00+07:00,ATHER"
last_update: "2026-08-14T00:00:00+07:00,ATHER"
status: "candidate"
attributes:
  doc_type: "security-threat-model"
  scope: "G-AnnStudio private BannerProject and author-asset sync"
  risk: "C-3/HIGH"
  backend_authority: "G-Maiden/supabase (shared gstore project)"
---

# G-AnnStudio private cloud sync — threat model and RLS contract

This document is the approved C-3/HIGH boundary for the first cloud-sync slice. It authorizes a private, owner-only project and author-asset store for G-AnnStudio. It does not authorize public sharing, collaboration, marketplace features, account-security changes, or any G-Maiden runtime cloud path.

## Decision and scope

| Decision | Contract |
| --- | --- |
| Identity | Existing Google OAuth session in the shared Supabase `gstore` project. `auth.uid()` is the only authorization subject. No password, GID login, Steam login, recovery factor, or MFA change is introduced. |
| Database | Dedicated `public.ann_projects` and `public.ann_project_assets` tables. The migration is owned by the G-Maiden `supabase/` authority because that checkout already owns the `gstore` schema. |
| Object storage | Private `ann-project-assets` bucket. Objects use the generated path `<owner_uuid>/<project_uuid>/<asset_uuid>` and are never public. |
| Client trust | The desktop WebView is an untrusted client. It receives only the Supabase publishable key and a user session; it never receives a service-role key. |
| Runtime boundary | G-Maiden stays local-first. Cloud sync has no route to GSI, CV, match state, G-Log, overlay telemetry, or runtime installation. |
| Conflict model | Optimistic concurrency on `revision`. A write includes the last observed revision; zero updated rows is a conflict. The client must offer keep-local, use-cloud, or duplicate and must never silently overwrite. |
| Delete model | Client deletes are tombstones (`deleted_at`) and do not grant hard-delete access. A separately audited service-role cleanup job may remove expired tombstones and objects; it is not part of the desktop client. |

## Data classification and cloud projection

Only an allowlisted cloud projection of `BannerProject` may be stored. The manifest JSON is capped at 2 MiB and each author asset at 50 MiB by the first migration; an aggregate product quota remains a separate production gate.

- project identity, title, event ID, artboard, schema version, revision, layer metadata, and asset IDs;
- asset name, kind, MIME, byte size, SHA-256, and opaque object path metadata;
- no local absolute path, `sourcePath`, `wavPath`, data URL, raw source bytes in JSON, or authoring-machine identifier.

The client uploads each asset as a private object and stores an `assetId` reference in the manifest. A pull downloads an object through a short-lived signed URL and rehydrates the local `source` only in memory/local project storage. The cloud manifest validator rejects these keys at every JSON depth: `gsi`, `match`, `cv`, `glog`, `game`, `telemetry`, `steam`, `steamid64`, `recovery`, `email`, `phone`, `auth`, `gid`, `gid_code`, `source`, `sourcePath`, and `wavPath`.

Raw GSI, match, CV, audio telemetry, G-Log, Steam identity, entitlement, recovery, and Google-account security data are prohibited. GID/display-name values are optional presentation metadata and are not authorization inputs.

## Trust boundaries and abuse cases

| Boundary / abuse case | Control | Evidence required |
| --- | --- | --- |
| Stolen publishable key or unauthenticated request | Supabase Auth session plus explicit `authenticated` grants; no `anon` table/storage access. | Privilege assertions and anonymous denial tests. |
| User changes `owner_id` or guesses another project UUID | `auth.uid()` RLS `USING` and `WITH CHECK`; composite project-owner foreign key; owner is immutable to the client. | Cross-account read/insert/update tests. |
| Object path traversal or another user's signed URL | Generated UUID-only path check; private bucket; Storage policies join the object name to an owner-owned active metadata row. | Storage policy test with foreign path and expired/tombstoned row. |
| Malicious client uploads game data in JSON | Cloud projection allowlist; recursive forbidden-key check in Postgres; client validator is defense in depth. | SQL check tests for nested forbidden keys and missing manifest fields. |
| Stale desktop silently overwrites newer work | `revision` compare-and-update; conflict is a first-class result. | Concurrent update test and UI conflict-state test. |
| Asset upload succeeds but manifest fails, or vice versa | Upload metadata first, then object, then manifest revision; failures retain local draft and mark the asset/project for retry. | Failure-path test and reconciliation runbook evidence. |
| Cloud outage or expired session | Local project remains authoritative for editing; sync is explicit and fail-closed. | Offline/signed-out unit tests. |
| Service-role misuse | Service role is limited to migration/cleanup operations and never bundled in the app or exposed through a browser route. | Secret scan and deployment checklist. |
| Runtime data reaches authoring cloud | No shared runtime client, no G-Maiden cloud endpoint, and no sync call from the GSI/event path. | Import graph and privacy regression review. |

## Database contract

### `public.ann_projects`

`id uuid primary key`, `owner_id uuid references auth.users(id)`, `title`, `event_id`, `schema_version = 1`, `revision bigint`, `project_json jsonb`, timestamps, and `deleted_at`. The row is visible only while `owner_id = auth.uid()` and `deleted_at is null`. Client insert/update is owner-only; client hard delete is not granted.

`project_json` must be a v1 object containing `schemaVersion`, `id`, `title`, `eventId`, `artboard`, `assets`, `layers`, and `revision`. A database check recursively rejects the forbidden-key set above. The database is not a replacement for the TypeScript schema validator; both are required.

### `public.ann_project_assets`

`id uuid primary key`, `project_id`, `owner_id`, `object_path`, `name`, `kind`, `mime`, `byte_size`, `sha256`, timestamps, and `deleted_at`. The composite `(project_id, owner_id)` foreign key prevents an asset row from being attached to a project owned by another user. Object paths are generated UUID triples only; clients cannot choose a different owner prefix.

The initial MIME allowlist is `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/svg+xml`, `video/mp4`, and `video/webm`. The provider's 50 MiB object limit is the hard per-object ceiling; any smaller product quota must be enforced before upload and recorded in the client contract.

## RLS and grants matrix

All four database operations below are scoped to `TO authenticated`; there is no `anon` policy. Every update has both a row predicate (`USING`) and a new-row predicate (`WITH CHECK`).

| Resource | Select | Insert | Update | Delete |
| --- | --- | --- | --- | --- |
| `ann_projects` | own active rows | `owner_id = auth.uid()` | own row; owner remains `auth.uid()`; tombstone allowed | denied to client |
| `ann_project_assets` | own active project assets | owner + active own project | owner + active own project; tombstone allowed | denied to client |
| `storage.objects` in `ann-project-assets` | active owner metadata match | existing active owner metadata match | same owner metadata match (`USING` + `WITH CHECK`) | active owner metadata match |

`public`, `anon`, and `authenticated` receive no implicit table access. Explicit grants give `authenticated` only the CRUD verbs in this matrix; `anon` receives none. No client-facing `SECURITY DEFINER` function is required for the first slice.

## Retention, deletion, and signed URLs

- The client marks a project/asset deleted and immediately hides it from normal reads. A cleanup worker owned by the backend repository must delete the object and row only after an approved retention interval; until that worker exists, tombstones are retained and the feature is not production-ready.
- Signed URLs are private, asset-specific, and at most five minutes. They are never placed in a project manifest, log, URL query sent to another service, or G-Maiden runtime payload.
- Storage and database deletion must be audited by the backend operator. Provider backups and Auth retention are outside the desktop client's authority and must be documented before production enablement.

## Offline and conflict state machine

`local-only → syncing → synced` is the normal path. Network loss or an expired session yields `offline`/`failed` while preserving the last valid local project. A revision mismatch yields `conflict`; the user chooses keep-local (retry against the latest base), use-cloud (replace the local draft after confirmation), or duplicate-project. No automatic last-write-wins behavior is permitted.

## Rollback and verification gates

1. Apply the migration only through the G-Maiden `supabase/` migration history; do not edit the hosted schema manually.
2. Run pgTAP tests for RLS, grants, recursive manifest rejection, object-path checks, and cross-account denial against a local database before any remote push.
3. Deploy the migration before enabling the client sync control. If migration verification fails, keep the UI disabled and remove only the new migration in a forward fix; never reset the shared schema.
4. Run Supabase security advisors, secret scans, TypeScript tests, and a signed-out/offline smoke. A green local test does not prove hosted cleanup, backup, or live signed-URL evidence.

## Non-goals and open operational evidence

- No public gallery, share link, collaborative editing, comments, marketplace, team/organization ownership, or cross-account transfer.
- No MFA, phone OTP, recovery, profile, entitlement, or Terms changes.
- No automatic G-Maiden installation or overlay-layout cloud sync.
- Before production, the owner must approve the cleanup worker, retention interval, aggregate quota, hosted migration run, and live cross-account signed-URL denial evidence.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0 | 2026-08-14 | candidate | Approved the first private G-AnnStudio cloud-sync threat model, data boundary, Supabase/RLS contract, conflict semantics, and rollback gates. | pending | ATHER |
