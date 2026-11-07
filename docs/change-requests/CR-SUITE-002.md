# CR-SUITE-002 — Versioned banner asset handoff

Status: JSON Schema, shared manifest/integrity validator, AnnStudio managed-project
ZIP importer, and a bounded 3D Studio still-image producer are implemented on the
stacked PR branch. Real native producer-to-consumer/reopen evidence is still a
completion gate. Editable-template and baked-video producer paths remain future work.
Depends on CR-SUITE-001 (PR #20). Do not mark this CR complete until both
applications round-trip a real asset.

## Contract now defined

`schemas/banner-asset-v1.schema.json` and `@g-suite/banner-contracts` define the
portable banner manifest, capability claims, strict BannerProject v1 envelope,
portable managed asset IDs and source-file SHA-256 verification.
`.gann` remains the immutable playable package. `.ann` remains the editable
announcer project. The authoring handoff must not impersonate either format or
silently revise the Store/runtime contract.

Envelope includes `format`, `schemaVersion`, stable `assetId` + `revision`, display
name, `mediaKind`, editability, provenance and indexed files with safe relative
paths, media types, byte sizes and hashes. Template projects carry BannerProject
schemaVersion 1. Voice/event pairing occurs later in AnnStudio and is not guessed
or stored as independent random selection here.

`editable-template` can expose title and data-backed outer motion. Its inline
BannerProject must use the actual fields from AnnStudio. `BannerAsset.id` remains the
editor identity used by layer references; `BannerAsset.source` points to a hashed
package file ID, which may differ from the BannerAsset ID. Each source must map to
exactly one file, with matching MIME/media type. External/data/remote paths are
rejected. V1 intentionally excludes SVG and other unsupported source media. `baked-video`
must be silent WebM and may advertise only the outer opacity/translation/scale
operations the consumer actually implements. Editing baked text requires a
source template and a render. `still-image` is explicitly static.

V1 proposal limits: JSON manifest ≤1 MiB; ≤64 files; ≤256 MiB per file; ≤512 MiB
total; baked render ≤18.2 seconds. The byte limits are conservative transfer ceilings
chosen for this first contract; they are not verified Store quotas or current
application-wide limits. Measure real asset sizes before producer/importer adoption.
Do not claim renderer/alpha compatibility solely from metadata. Native playback
parity remains separate. The reader calls `parseBannerAssetManifest` with raw bytes
before parsing so the 1 MiB check applies to the actual input, not normalized JSON.

## Completion gates for the follow-up slices

1. Export immutable manifest + bytes from a named Studio project/revision. Re-export
   must preserve its previous revision; source filenames and absolute paths are not
   written into a portable package.
2. Import in AnnStudio with path traversal, zip bomb/expanded-size, duplicate path,
   extra file, unsupported type/schema, size and digest checks before project writes.
3. Snapshot verified bytes under project-managed storage and bind references by
   stable ID/hash; never retain a mutable external drive path.
4. Manual select/apply to an event variant preserves voice identity and reports the
   capabilities honestly. Do not auto-map an asset or mutate event assignments.
5. Edit/update of a source revision never changes an existing project snapshot or
   built artifact without an explicit adoption action.
6. Prove template text/motion editability and silent video limits in both apps;
   verify GANN export uses the existing builder and package verifier.
7. Tauri/Windows tests cover malicious archive cases, concurrent import, disk failure,
   cancellation and rollback. Native alpha render verification must be separate.

## AnnStudio importer slice — 2026-11-04

`codex/annstudio-banner-import` implements the consumer side against the PR #22
BannerProject identity contract. It reads a `.zip` containing one root
`manifest.json` and exactly the indexed `assets/<filename>` entries. Tauri validates
the checked-in JSON Schema and cross-file invariants, streams each payload through
size/hash verification into a temporary directory, and re-verifies the previewed
manifest digest at Apply. It rejects directories, symlinks, extra entries, aliases,
unsafe/device paths, unsupported media roles, font-file references, and current
AnnStudio renderer limits before project recovery is updated.

The Pack Workflow offers a read-only preview and explicit apply to one voice clip.
Editable templates retain their BannerAsset and layer IDs while package file IDs map
to project-managed content-addressed assets. Still images become image layers and
silent WebM becomes a video layer. Apply aligns the banner `eventId` to the manually
selected voice clip, records source `assetId`/revision/manifest digest, and preserves
voice assets, clip contents, event mappings, banner IDs, SFX and other variants.
Import uses the existing GANN build pipeline; it does not change `.gann`, Store, or
G-Maiden contracts.

Importer-specific limits are enforced at the consumer boundary: manifest ≤1 MiB,
64 files, 256 MiB per file, 512 MiB expanded total, 4096 BannerProject assets/layers,
and 1920×1080 artboards. V1 font bytes are not indexable (support files are raster
only), so templates with `fontAssetId` are rejected instead of silently substituting
a font. The selected variant's existing visual duration remains unchanged; a baked
video is rendered only across that event's configured visual interval.

Remaining gates: the still-image producer is implemented, but native
producer-to-consumer/reopen evidence is pending. Cancellation while the native Apply
worker is already running is not implemented. A failed multi-file copy leaves the
previous recovery snapshot intact, but may leave unreferenced content-addressed
files in the local project cache; cleanup/rollback of those orphan files is future
work. Native codec/alpha parity, installed-app UI validation and the remaining
concurrent/disk-full cases are still separate acceptance work. See
`CR-SUITE-002-VALIDATION.md` for exact checks and evidence.

## 3D Studio producer slice — 2026-11-04

The producer exports one selected PNG, WebP or JPEG from a named local Studio
project as an immutable `still-image` Banner Asset v1 ZIP. It validates the project
identity, rejects linked/reparse-point project and export paths, checks the source
regular-file status, media signature, 256 MiB bound and SHA-256 while streaming.
Archive names and manifest paths are fixed; the source filename and local path are
not serialized. Revisions are created with a no-overwrite final step under
`<project>/exports/<assetId>/`. The AnnStudio user explicitly selects the voice
clip/event pairing during import.

Editable BannerProject templates and rendered silent WebM are not produced in this
slice. The code-level Studio producer → AnnStudio importer → `.ann` save/reopen
round trip passes on an isolated fixture. Native-window, installed-app UI and DPI
acceptance remain separate completion gates.

CR-ANN-WORKFLOW-001 then makes asset selection part of the event card + paired
voice/banner/motion flow designed in `F:/g-suit/annstudio-design-proposal/v3`.
