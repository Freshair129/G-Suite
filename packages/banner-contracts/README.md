# Portable banner asset contract

`schemas/banner-asset-v1.schema.json` defines the authoring handoff used to move an
asset between production tools. It is separate from the verified `.gann` runtime
package and the editable `.ann` project. It does not grant Store, publisher, or
runtime trust; the receiving author must verify every listed byte before import.

The manifest records a stable asset ID/revision, declared media kind, edit controls,
provenance, relative files, byte lengths and SHA-256 digests. ZIP/folder readers must
reject absolute paths, traversal, case aliases/device names, duplicate/extra/unlisted
entries, unsupported schema versions, oversized input and digest mismatches before
publishing an imported asset. Use a new revision instead of overwriting existing
asset history. Call `parseBannerAssetManifest(rawBytes)` before JSON parsing so the
1 MiB bound applies to actual UTF-8 input, not normalized `JSON.stringify` size.

Kinds communicate capabilities honestly:

- `editable-template` carries a schema-versioned `BannerProject` inline in the
  manifest. Listed supporting media are hashed and verified as separate entries.
- `baked-video` is a silent WebM render with duration and explicitly listed outer
  opacity/translation/scale controls. Its internal text/animation is not editable.
- `still-image` is PNG, WebP or JPEG and makes no claim about animation or audio.
  An event may still apply supported outer motion where that capability is shown.

Editable templates carry the real BannerProject v1 envelope. Each `BannerAsset.id`
remains the editor identity used by layer references. Its `source` must use
`asset:<file-id>` to reference exactly one indexed package file; that file ID is
allowed to differ from the `BannerAsset.id`. The indexed file's media type must
match the BannerAsset MIME type. Local paths, URLs, data URLs and SVG/other
non-raster media are rejected by v1.

The JSON Schema validates the portable JSON shape, field ranges and media-kind
rules. It cannot express every cross-field invariant, so importers must also run
`validateBannerAssetManifest` and `verifyBannerAssetFiles`. The runtime validator
checks ID/reference joins, BannerAsset-to-file one-to-one mapping and media-type
agreement, parent groups, ordered keyframes, case-insensitive path aliases,
aggregate byte ceilings and serialized manifest size in addition to the schema. A
schema-only pass is not an import acceptance check.

Proposed v1 limits: manifest 1 MiB, 64 entries, 256 MiB each, 512 MiB total, render
≤18.2 seconds. These are design ceilings, not measured Store quotas; check real
media sizes before implementing producer export. AnnStudio consumes this contract
through an explicit preview/apply flow. Its native ZIP reader expects one root
`manifest.json` plus exactly the listed files, streams and hashes each file, then
copies verified bytes into project-managed storage. V1 packages with `fontAssetId`
references are rejected by AnnStudio because the contract indexes raster supporting
files only. G-AnnStudio/3D Studio producer export is still open, so the applications
do not yet round-trip a real asset.

```powershell
node --test packages/banner-contracts/src/index.test.js
```

See [CR-SUITE-002](../../docs/change-requests/CR-SUITE-002.md).
