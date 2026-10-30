# Local G-Ann Package v1

`.gann` is one indexed ZIP containing `gann.json`, one `ann_<UUID>.json`, all ID-named `audio/*.wav`, silent `video/*.webm`, and optional inert `motion/` source/font stock. Registry bytes preserve all component/cue/config fields. Every payload file is indexed with byte length and SHA-256; the descriptor itself is bounded to 2 MiB. Maximum container/expanded size 512 MiB, individual file 32 MiB, 2048 payload files. Unsafe names, symlinks, case collisions, extra/missing files and mismatched hashes are rejected. It is a local unsigned package, not a Store entitlement.

Open through **เปิด .gann** in the header, then choose an event and **เล่นภาพพร้อมเสียง**. The package panel does not overwrite the current source/clips project. Save Copy preserves the entire archive byte-for-byte, using a temporary sibling and verified atomic commit; it refuses existing destinations. Passing a `.gann` file as the application's argument opens the panel automatically. Installed bundle configuration declares the file association; no-bundle builds do not register it.

The same crate source is vendored under each app's src-tauri/gann-package, with no runtime cross-repository import. G-Maiden imports from trusted Control, keeps the original under voice-cache/containers/<sha>.gann and builds one verified filesystem playback cache. The audio hot path never unzips a container. Local eligibility is separate from signed Store receipts. No SQL was added; the pre-existing Studio sound-library database is unchanged.

## Container contract

The reader and writer live in [`../src-tauri/gann-package`](../src-tauri/gann-package). This indexed ZIP format is separate from the existing installed `pack-manifest` and transfer schemas: opening a package in Studio does not install or activate a G-Maiden pack.

| `gann.json` field | Contract |
| --- | --- |
| `format` | `g-ann-package` |
| `version` | `1` |
| `announcer_id` | `ann_` followed by a lowercase hexadecimal UUID |
| `manifest` | `<announcer_id>.json` at the ZIP root |
| `files` | Every payload, exactly once, as `{path, bytes, sha256}`; excludes `gann.json` |

The registry uses `schema_version: 1`, matching `announcer_id`, positive integer `revision`, and a nonempty string `name` of at most 256 bytes. Its `sounds` use unique `snd_<UUID>` identities, matching `audio/<sound_id>.wav` paths and indexed `sha256`. Its `banners` use unique `bnr_<UUID>` identities, `event_key`, `original_sound_id`, `playback_sound_id`, and `visual_source` (`root: "."`, `silent: true`, indexed `sha256`, and `video: "video/<banner_id>.webm"`). Other component, cue and `config` fields are preserved. Every banner sound reference must resolve. `events` maps event keys to arrays of `{sound_id, banner_id}` pairs; each pair must match that banner's event and original sound. Runtime consumers still decide whether an event is eligible. Motion source and fonts are inert payloads, never executed by the importer.

## Reproducible packaging

From this repository's root, with a source directory containing its registry and referenced media:

```powershell
cargo run --locked --manifest-path packages/ann-studio/src-tauri/gann-package/Cargo.toml -- pack D:/my-pack ann_00000000-0000-0000-0000-000000000001.json D:/my-pack.gann
cargo run --locked --manifest-path packages/ann-studio/src-tauri/gann-package/Cargo.toml -- verify D:/my-pack.gann
cargo test --locked --manifest-path packages/ann-studio/src-tauri/gann-package/Cargo.toml
```

The writer creates and verifies a temporary sibling before committing a new destination; verification prints the announcer ID, file count and archive SHA-256. No sample voice or banner media is included in this repository. Native preview, acoustic sync, interrupted frame-drop and whole-match performance claims require separate evidence.
