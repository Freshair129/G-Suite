# CR-SUITE-002 — Versioned banner asset handoff

Status: JSON schema and shared manifest/integrity validator implemented; application import/export remains open.
Depends on CR-SUITE-001 (PR #20). Follow-up implementation should add the
producer's export and AnnStudio's managed-project import as separately reviewable
slices. Do not mark this CR complete until both applications round-trip real assets.

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
BannerProject must use the actual fields from AnnStudio and each referenced raster
asset ID must match a hashed package file; external/data/remote paths are rejected.
V1 intentionally excludes SVG and other unsupported source media. `baked-video`
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

CR-ANN-WORKFLOW-001 then makes asset selection part of the event card + paired
voice/banner/motion flow designed in `F:/g-suit/annstudio-design-proposal/v3`.
