# G-AnnStudio — Content-Type Taxonomy (Design Proposal)

Status: **proposal, not implemented.** Markdown only — no code changed. Owner sign-off needed on the open questions before any work starts.

## 0. Where we are today

The studio has exactly **one** authoring model: a single source `.wav` → many `Clip`s (time windows into that wav), each optionally mapped to a G-Maiden `event`, tuned in the Mastering deck, then shipped as a **manifest-based announcer pack** (`install_gmaiden_pack`). Key shapes:

- `Clip` (`useStudioStore.ts`) — `{id,name,start,end,event,color, gain/fadeIn/fadeOut/normalize/speed/master}`. Always a slice of `wavPath`.
- Manifest (`lib.rs`) — `{id,name,version,locale,author,description,coverImage, mappings:{event:{text,thai,banner,bannerAsset,clips[]}}}`.
- Flow (`SourceView` + `MasteringPanel`) — **import → auto-split (Whisper) → map events → tune → export / install**.
- Banners today are **auto-generated tone banners** per mapped event (`toneBanner.ts`); there is no first-class banner asset list, no sfx concept, and no notion of "what kind of project is this".

The 6 requested types are all expressible as **subsets / supersets of the existing manifest** — this is an additive layering job, not a rewrite.

## 1. The six content types vs. the current model

| Type | Contains | Maps onto current model | Reusable | New |
| --- | --- | --- | --- | --- |
| **voice** | 1 voice clip | one `Clip`, mapped to 1 event, manifest with a single `mappings[event].clips[0]` | import→split→tune→export path, `Clip`, ffmpeg cut | "single-clip" project guard; export names by event, not pack |
| **voice pack** | N voice clips | today's default: many `Clip`s → `mappings{event:{clips[]}}` | **entire current flow as-is** | nothing (this is the baseline) |
| **sfx** | 1+ non-speech clips (stingers, whooshes) | same as voice/voice-pack but the mapped id is an **sfx id**, not a persona event; no `text/thai`, no Whisper transcript | `Clip`, tuning, ffmpeg cut, manifest `clips[]` | sfx-id namespace (see §2); auto-split should be manual/silence-based, not Whisper |
| **banner** | 1 banner image | `coverImage` + one `mappings[event].bannerAsset`; **no audio** | manifest writer, `BannerAsset` install arg, banners/ dir | image asset in store (no `Clip`); image-only authoring surface |
| **banner pack** | N banner images (per-event) | `mappings{event:{bannerAsset}}` with empty `clips[]` | manifest writer, per-event banner loop in `install_gmaiden_pack` | banner **list** in store; per-event image picker; no waveform |
| **announcer pack** | voice + banner + announcer + sfx bundle | the **full manifest** — `mappings{event:{text,thai,bannerAsset,clips[]}}` + sfx entries | everything | a project that holds **both** a clip list and a banner list, and can include sfx ids alongside events |

Takeaway: **announcer pack is the union**; the other five are constrained projections of it. Build the union's data model once, gate the UI per type.

## 2. Data-model changes

1. **`contentType` on the project** — add `contentType: "voice" | "voice_pack" | "sfx" | "banner" | "banner_pack" | "announcer_pack"` to the persisted store slice (`partialize`) and echo it into the manifest (new `contentType` field; G-Maiden can ignore unknown keys, so it stays backward-compatible). This is the single switch that drives UI gating and export validation.
2. **Banners need their own list.** Today banners are derived (tone banners) or a single install arg. For **banner / banner pack / announcer pack** we need a first-class array in the store, e.g. `banners: BannerAsset[] = {id,event,assetPath,ext}` — parallel to `clips`, not a field on `Clip` (a banner has no start/end/gain). Reuse the existing history/undo pattern.
3. **SFX differ from voice by *id namespace and metadata*, not by shape.** An sfx `Clip` carries no `text/thai` and its `event` field instead references an **sfx id** (e.g. `sfx.whoosh_01`). Options: (a) a reserved `sfx.*` prefix inside the same `event` slot, or (b) a sibling `sfxId` field. Prefix is cheaper and keeps one mapping table. SFX also skip Whisper — split on silence or by hand.
4. **Manifest stays one schema.** No breaking change: voice-only packs leave `bannerAsset` empty (already the default), banner-only packs leave `clips[]` empty, sfx add `sfx.*` keys to `mappings`. `install_gmaiden_pack` already tolerates empty `clips`/`banners` per event — the main gap is it currently **requires** at least one mapped clip (`mappings.is_empty()` guard), which must relax for banner-only packs.

## 3. UI / flow implications

- **Type picker at project start.** New-project modal (or the empty state in `SourceView`) offers the 6 tiles. Selection sets `contentType` and configures the workspace; changing it later is a guarded reset.
- **Per-type flow:**
  - *voice / voice pack* — unchanged (import→split→map→tune→export). voice enforces "exactly one clip/event".
  - *sfx* — same surface, but **hide Whisper auto-split** (offer silence-split / manual cut), hide `text/thai`, and swap the event picker for an **sfx-id picker**. Mastering deck stays (sfx want gain/fades too).
  - *banner* — **no audio, no waveform, no Mastering deck.** The workspace becomes an image drop + preview + event assignment; export writes `coverImage`/`bannerAsset` only.
  - *banner pack* — banner grid, one image per event, no timeline.
  - *announcer pack* — the full studio: current clip list **plus** a banner column, sfx allowed in the same event map. This is `SourceView` + a banner sub-panel.
- **Export/install button** reads `contentType` to pick validation ("map ≥1 event" for voice; "≥1 banner" for banner; either for announcer) and label.

## 4. Phased implementation (smallest-viable first)

- **P0 — shared infra (no visible change):** add `contentType` to store + manifest, add the `banners: BannerAsset[]` list to the store (unused yet), relax the `mappings.is_empty()` guard in `install_gmaiden_pack` to allow banner-only. Ship behind the existing default (`voice_pack`) so nothing regresses.
- **P1 — voice + voice pack:** formalize the two existing flows behind the type picker (voice = single-clip guard). Lowest risk, mostly labeling + validation. **Do this first — it's 90% present.**
- **P2 — banner + banner pack:** the first genuinely new surface (image list, no waveform). Reuses P0's banner list and manifest writer.
- **P3 — sfx:** sfx-id namespace + manual/silence split + hidden transcript. Reuses the clip/tuning/ffmpeg path.
- **P4 — announcer pack:** compose P1+P2+P3 surfaces into one project. Nothing new in the data model if P0 was done right.

## 5. Open questions for the owner

1. **sfx ids** — do we invent a `G-AnnStudio` sfx-id list, or does G-Maiden need to define/consume `sfx.*` ids first (contract change in `gmaiden-events.json`)? Blocks P3.
2. **Banner formats** — install already accepts png/webp/webm/gif/apng. Do we allow **animated** banners (webm/apng) in the authoring UI, or static-only for v1?
3. **Type immutability** — can a user convert a project's type mid-way (e.g. voice pack → announcer pack by adding banners), or is type fixed at creation? Immutable is simpler; convertible is nicer.
4. **Single vs. multi source** — voice pack today is clips of **one** source wav. Should sfx / voice packs allow **multiple source files** (import several, each its own clip), or keep the one-source model? Affects the store's `wavPath` (scalar today).
5. **Announcer-pack scope** — does "announcer" imply anything beyond the existing G-Maiden streak/kill events (a distinct announcer clip set), or is it just "voice + sfx + banner" under the current event contract?
