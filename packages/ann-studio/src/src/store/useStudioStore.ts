// @req GOE-001, GOE-002 — persists BannerProject state, selection, and history.
// @spec SDD-001, SDD-002 — keeps the project model separate with bounded history.
// @designs docs/g-overlay-lab-figma-editor-spec.md
// @tested src/store/useStudioStore.test.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { cloneDefaultOverlayLayout, OVERLAY_MODULE_IDS, type OverlayLayout } from "../lib/overlayLayout";
import { cloneBannerProject, createDefaultBannerProject, type BannerProject } from "../lib/bannerProject";

export interface Clip {
  id: string;
  name: string;
  start: number;
  end: number;
  event: string;
  color: string;
  // --- standalone library-file clip (from "open pack" / drag from library).
  //     When set, this clip is its OWN wav at `<libraryRoot>/filePath` (start/end
  //     are within that file, fileDur = its full length), not a segment of the
  //     shared source wav. Lets the SourceView canvas hold a whole pack's sounds.
  filePath?: string;
  fileDur?: number;
  // the ORIGINAL file this clip came from (imported video/audio, or the library
  // sound's own source). Carried through open-pack / drag so a re-saved pack
  // references the true origin per clip, not the current import.
  source?: string;
  // --- tuning (focused set; applied via ffmpeg on export). Optional so older
  //     clips / persisted projects still load. EQ/compressor params go here next.
  gain?: number; // dB, default 0
  fadeIn?: number; // seconds, default 0
  fadeOut?: number; // seconds, default 0
  normalize?: boolean; // default false
  speed?: number; // playback rate, default 1 (0.5–2.0)
  gainL?: number; // per-channel dB (stereo balance), default 0
  gainR?: number; // per-channel dB, default 0
  // LANDR-style mastering knobs — visual/mock for now (eqLow/eqMid/eqHigh,
  // presence, deEsserAmt/deEsserFreq, compression/character/saturation, stereo),
  // wired to ffmpeg in the (ข) pass. Loudness maps to `gain` above.
  master?: Record<string, number>;
}

export type AppView = "studio" | "profile" | "settings" | "test" | "overlay" | "source";

/** Author-supplied banner image that replaces the auto tone-banner for one event.
 *  `b64` has NO `data:` prefix (ready for the Rust install command); `mime` is
 *  kept only so the UI can build a preview data URL. Animated formats (webp/gif/
 *  apng) pass straight through to G-Maiden's overlay. */
export interface BannerOverride {
  b64: string;
  // APNG is normalized to png — it is a valid PNG container and G-Maiden's
  // overlay (WebView2/Chromium) animates it under image/png.
  ext: "png" | "webp" | "gif";
  mime: string;
}

export interface VoiceCacheMap {
  [event: string]: string[];
}

export interface LibraryNode {
  name: string;
  path: string;
  is_folder: boolean;
  duration: number | null;
  children: LibraryNode[];
}

export interface LibPkg {
  id: string;
  name: string;
  game: string;
  file_type: string;
  quality: string;
  clip_count: number;
  created_at: string;
}

export interface LibSound {
  id: number;
  pkg_id: string;
  idx: number;
  name_th: string;
  name_en: string;
  file_path: string;
  source_path: string;
  duration: number;
  events: string[];
}

// ---- Editor (timeline) types ----

export type EditorTool = "select" | "cut" | "trim" | "stretch";

export interface TrackItem {
  id: string;
  trackIdx: number;
  /** offset in seconds on the timeline */
  offset: number;
  duration: number;
  name: string;
  /** relative path inside sounds dir */
  filePath: string;
  volume: number;
  speed: number;
  fadeIn: number;
  fadeOut: number;
  color: string;
  reverb: number;
  delay: number;
  noise: number;
  bass: number;
  mid: number;
  treble: number;
  pitch: number;
  normalize: boolean;
  compRatio: number;
  compAttack: number;
  compRelease: number;
  makeup: number;
}

export interface SoundMapping {
  sound_path: string;
  sound_name: string;
  volume: number;
  speed: number;
}

export interface Pack {
  id: string;
  name: string;
  pack_type: "full" | "single" | "custom";
  events: string[];
  mappings: Record<string, SoundMapping>;
  created_at: string;
  updated_at: string;
}

interface StudioState {
  sourcePath: string | null;
  wavPath: string | null;
  duration: number;
  clips: Clip[];
  // undo/redo history for `clips` (the authoring surface)
  pastClips: Clip[][];
  futureClips: Clip[][];
  selectedClipId: string | null;
  model: string;
  transcribing: boolean;
  provider: "ollama" | "claude";
  llmModel: string;
  /** Stable Diffusion WebUI (A1111-compatible) base URL for AI banner art */
  sdEndpoint: string;

  view: AppView;
  gmaidenConnected: boolean;
  gmaidenPath: string;
  voiceCache: VoiceCacheMap;
  overlayLayout: OverlayLayout;
  pastOverlayLayouts: OverlayLayout[];
  futureOverlayLayouts: OverlayLayout[];
  bannerProject: BannerProject;
  pastBannerProjects: BannerProject[];
  futureBannerProjects: BannerProject[];
  selectedBannerLayerIds: string[];

  /** event id → author banner override (unset = use the auto tone banner) */
  bannerOverrides: Record<string, BannerOverride>;

  /** event id → library sounds assembled on the test screen (the pack builder) */
  packBuilder: Record<string, LibSound[]>;

  libraryRoot: string;
  libraryTree: LibraryNode[];
  libraryPackages: LibPkg[];
  packs: Pack[];
  activePackId: string | null;

  // editor (timeline)
  editorTool: EditorTool;
  trackItems: TrackItem[];
  trackCount: number;
  selectedItemId: string | null;
  timelineZoom: number; // px per second
  playheadPos: number; // seconds
  masterVolume: number;

  setSource: (source: string, wav: string, duration: number) => void;
  addClip: (clip: Clip) => void;
  updateClip: (id: string, patch: Partial<Clip>) => void;
  removeClip: (id: string) => void;
  selectClip: (id: string | null) => void;
  setClips: (clips: Clip[]) => void;
  undoClips: () => void;
  redoClips: () => void;
  /** snapshot current clips into history once (call at drag start) */
  pushHistory: () => void;
  /** update a clip WITHOUT touching history (live drag; pair with pushHistory) */
  updateClipSilent: (id: string, patch: Partial<Clip>) => void;
  /** split a clip at `atTime` into two adjacent clips (the split tool) */
  splitClip: (id: string, atTime: number) => void;
  /** move a clip to a new index (drag-to-reorder) */
  moveClip: (id: string, toIndex: number) => void;

  // transient playhead for the waveform needle (not persisted)
  playheadId: string | null;
  playheadT: number;
  setPlayhead: (id: string | null, t: number) => void;
  setModel: (model: string) => void;
  setTranscribing: (v: boolean) => void;
  setProvider: (p: "ollama" | "claude") => void;
  setLlmModel: (m: string) => void;
  setSdEndpoint: (url: string) => void;
  setView: (v: AppView) => void;
  setGMaiden: (connected: boolean, path: string, cache: VoiceCacheMap) => void;
  /** set the G-Maiden install directory (where packs are written) */
  setGmaidenPath: (path: string) => void;
  setOverlayLayout: (layout: OverlayLayout) => void;
  undoOverlayLayout: () => void;
  redoOverlayLayout: () => void;
  setBannerProject: (project: BannerProject) => void;
  setBannerProjectSilent: (project: BannerProject) => void;
  pushBannerProjectHistory: () => void;
  undoBannerProject: () => void;
  redoBannerProject: () => void;
  setSelectedBannerLayerIds: (ids: string[]) => void;
  /** set (ov) or clear (null) the banner override for one event */
  setBannerOverride: (event: string, ov: BannerOverride | null) => void;
  /** pack builder: assign / unassign a library sound to an event */
  addToPackBuilder: (event: string, sound: LibSound) => void;
  removeFromPackBuilder: (event: string, idx: number) => void;
  clearPackBuilder: () => void;
  setLibrary: (root: string, tree: LibraryNode[]) => void;
  setLibraryPackages: (pkgs: LibPkg[]) => void;
  setPacks: (packs: Pack[]) => void;
  setActivePack: (id: string | null) => void;
  updatePack: (pack: Pack) => void;

  // editor
  setEditorTool: (t: EditorTool) => void;
  addTrackItem: (item: TrackItem) => void;
  updateTrackItem: (id: string, patch: Partial<TrackItem>) => void;
  removeTrackItem: (id: string) => void;
  selectItem: (id: string | null) => void;
  setTimelineZoom: (z: number) => void;
  setPlayheadPos: (p: number) => void;
  setTrackCount: (n: number) => void;
  setMasterVolume: (v: number) => void;

  // optional Google sign-in (gstore GID hub) — fills authorGid/display-name
  // for exported packs; every authoring flow works signed-out
  gid: string;
  gidDisplayName: string;
  gidSignedIn: boolean;
  setGidAuth: (p: { gid: string; displayName: string; signedIn: boolean }) => void;
}

const COLORS = [
  "#2898e0", "#e05a28", "#28e05a", "#e0c828", "#a028e0",
  "#e028a0", "#28e0c8", "#e07828", "#5ae028", "#2858e0",
];

let colorIdx = 0;
function nextColor() {
  return COLORS[colorIdx++ % COLORS.length];
}

let idCounter = 0;
export function genId() {
  return `clip_${++idCounter}_${Date.now().toString(36)}`;
}

export function packId() {
  return `pack_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

const HISTORY_MAX = 50;
const OVERLAY_LAYOUT_HISTORY_MAX = 100;

function cloneOverlayLayout(layout: OverlayLayout): OverlayLayout {
  return Object.fromEntries(OVERLAY_MODULE_IDS.map((id) => [id, { ...layout[id] }])) as OverlayLayout;
}

function overlayLayoutsEqual(left: OverlayLayout, right: OverlayLayout): boolean {
  return OVERLAY_MODULE_IDS.every((id) =>
    Object.is(left[id].x, right[id].x) &&
    Object.is(left[id].y, right[id].y) &&
    Object.is(left[id].scale, right[id].scale) &&
    left[id].enabled === right[id].enabled,
  );
}

export const useStudioStore = create<StudioState>()(
  persist(
    (set) => ({
      sourcePath: null,
      wavPath: null,
      duration: 0,
      clips: [],
      pastClips: [],
      futureClips: [],
      playheadId: null,
      playheadT: 0,
      selectedClipId: null,
      model: "medium",
      transcribing: false,
      provider: "ollama",
      llmModel: "",
      sdEndpoint: "http://127.0.0.1:7860",

      view: "studio",
      gmaidenConnected: false,
      gmaidenPath: "",
      voiceCache: {},
      overlayLayout: cloneDefaultOverlayLayout(),
      pastOverlayLayouts: [],
      futureOverlayLayouts: [],
      bannerProject: createDefaultBannerProject(),
      pastBannerProjects: [],
      futureBannerProjects: [],
      selectedBannerLayerIds: [],
      bannerOverrides: {},
      packBuilder: {},

      libraryRoot: "",
      libraryTree: [],
      libraryPackages: [],
      packs: [],
      activePackId: null,

      editorTool: "select",
      trackItems: [],
      trackCount: 3,
      selectedItemId: null,
      timelineZoom: 60,
      playheadPos: 0,
      masterVolume: 1,

      setSource: (source, wav, duration) =>
        set({
          sourcePath: source,
          wavPath: wav,
          duration,
          clips: [],
          pastClips: [],
          futureClips: [],
          selectedClipId: null,
        }),

      addClip: (clip) =>
        set((s) => ({
          pastClips: [...s.pastClips, s.clips].slice(-HISTORY_MAX),
          futureClips: [],
          clips: [...s.clips, { ...clip, color: clip.color || nextColor() }],
          selectedClipId: clip.id,
        })),

      updateClip: (id, patch) =>
        set((s) => ({
          pastClips: [...s.pastClips, s.clips].slice(-HISTORY_MAX),
          futureClips: [],
          clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),

      removeClip: (id) =>
        set((s) => ({
          pastClips: [...s.pastClips, s.clips].slice(-HISTORY_MAX),
          futureClips: [],
          clips: s.clips.filter((c) => c.id !== id),
          selectedClipId: s.selectedClipId === id ? null : s.selectedClipId,
        })),

      selectClip: (id) => set({ selectedClipId: id }),

      setClips: (clips) =>
        set((s) => ({
          pastClips: [...s.pastClips, s.clips].slice(-HISTORY_MAX),
          futureClips: [],
          clips,
        })),

      undoClips: () =>
        set((s) =>
          s.pastClips.length
            ? {
                clips: s.pastClips[s.pastClips.length - 1],
                pastClips: s.pastClips.slice(0, -1),
                futureClips: [s.clips, ...s.futureClips].slice(0, HISTORY_MAX),
              }
            : s
        ),

      redoClips: () =>
        set((s) =>
          s.futureClips.length
            ? {
                clips: s.futureClips[0],
                futureClips: s.futureClips.slice(1),
                pastClips: [...s.pastClips, s.clips].slice(-HISTORY_MAX),
              }
            : s
        ),

      pushHistory: () =>
        set((s) => ({
          pastClips: [...s.pastClips, s.clips].slice(-HISTORY_MAX),
          futureClips: [],
        })),

      updateClipSilent: (id, patch) =>
        set((s) => ({
          clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),

      splitClip: (id, atTime) =>
        set((s) => {
          const idx = s.clips.findIndex((c) => c.id === id);
          if (idx < 0) return s;
          const c = s.clips[idx];
          if (atTime <= c.start + 0.03 || atTime >= c.end - 0.03) return s;
          const left: Clip = { ...c, end: atTime };
          const right: Clip = { ...c, id: genId(), start: atTime, color: nextColor() };
          return {
            pastClips: [...s.pastClips, s.clips].slice(-HISTORY_MAX),
            futureClips: [],
            clips: [...s.clips.slice(0, idx), left, right, ...s.clips.slice(idx + 1)],
            selectedClipId: right.id,
          };
        }),

      moveClip: (id, toIndex) =>
        set((s) => {
          const from = s.clips.findIndex((c) => c.id === id);
          if (from < 0 || toIndex < 0 || toIndex >= s.clips.length || from === toIndex) return s;
          const arr = s.clips.slice();
          const [moved] = arr.splice(from, 1);
          arr.splice(toIndex, 0, moved);
          return {
            pastClips: [...s.pastClips, s.clips].slice(-HISTORY_MAX),
            futureClips: [],
            clips: arr,
          };
        }),

      setPlayhead: (playheadId, playheadT) => set({ playheadId, playheadT }),

      setModel: (model) => set({ model }),

      setTranscribing: (transcribing) => set({ transcribing }),

      setProvider: (provider) => set({ provider }),

      setLlmModel: (llmModel) => set({ llmModel }),

      setSdEndpoint: (sdEndpoint) => set({ sdEndpoint }),

      setView: (view) => set({ view }),

      setGMaiden: (gmaidenConnected, gmaidenPath, voiceCache) =>
        set({ gmaidenConnected, gmaidenPath, voiceCache }),

      setGmaidenPath: (gmaidenPath) => set({ gmaidenPath }),
      setOverlayLayout: (overlayLayout) =>
        set((s) => {
          if (overlayLayoutsEqual(s.overlayLayout, overlayLayout)) return s;
          return {
            overlayLayout: cloneOverlayLayout(overlayLayout),
            pastOverlayLayouts: [...s.pastOverlayLayouts, cloneOverlayLayout(s.overlayLayout)].slice(-OVERLAY_LAYOUT_HISTORY_MAX),
            futureOverlayLayouts: [],
          };
        }),
      undoOverlayLayout: () =>
        set((s) => {
          const previous = s.pastOverlayLayouts[s.pastOverlayLayouts.length - 1];
          if (!previous) return s;
          return {
            overlayLayout: cloneOverlayLayout(previous),
            pastOverlayLayouts: s.pastOverlayLayouts.slice(0, -1),
            futureOverlayLayouts: [cloneOverlayLayout(s.overlayLayout), ...s.futureOverlayLayouts].slice(0, OVERLAY_LAYOUT_HISTORY_MAX),
          };
        }),
      redoOverlayLayout: () =>
        set((s) => {
          const next = s.futureOverlayLayouts[0];
          if (!next) return s;
          return {
            overlayLayout: cloneOverlayLayout(next),
            pastOverlayLayouts: [...s.pastOverlayLayouts, cloneOverlayLayout(s.overlayLayout)].slice(-OVERLAY_LAYOUT_HISTORY_MAX),
            futureOverlayLayouts: s.futureOverlayLayouts.slice(1),
          };
        }),
      setBannerProject: (bannerProject) =>
        set((s) => ({
          bannerProject: { ...bannerProject, revision: s.bannerProject.revision + 1 },
          pastBannerProjects: [...s.pastBannerProjects, cloneBannerProject(s.bannerProject)].slice(-HISTORY_MAX),
          futureBannerProjects: [],
        })),
      setBannerProjectSilent: (bannerProject) =>
        set((s) => ({ bannerProject: { ...bannerProject, revision: s.bannerProject.revision + 1 } })),
      pushBannerProjectHistory: () =>
        set((s) => ({
          pastBannerProjects: [...s.pastBannerProjects, cloneBannerProject(s.bannerProject)].slice(-HISTORY_MAX),
          futureBannerProjects: [],
        })),
      undoBannerProject: () =>
        set((s) => {
          const previous = s.pastBannerProjects[s.pastBannerProjects.length - 1];
          if (!previous) return s;
          return {
            bannerProject: previous,
            pastBannerProjects: s.pastBannerProjects.slice(0, -1),
            futureBannerProjects: [cloneBannerProject(s.bannerProject), ...s.futureBannerProjects].slice(0, HISTORY_MAX),
          };
        }),
      redoBannerProject: () =>
        set((s) => {
          const next = s.futureBannerProjects[0];
          if (!next) return s;
          return {
            bannerProject: next,
            pastBannerProjects: [...s.pastBannerProjects, cloneBannerProject(s.bannerProject)].slice(-HISTORY_MAX),
            futureBannerProjects: s.futureBannerProjects.slice(1),
          };
        }),
      setSelectedBannerLayerIds: (selectedBannerLayerIds) => set({ selectedBannerLayerIds }),

      setBannerOverride: (event, ov) =>
        set((s) => {
          const next = { ...s.bannerOverrides };
          if (ov) next[event] = ov;
          else delete next[event];
          return { bannerOverrides: next };
        }),

      addToPackBuilder: (event, sound) =>
        set((s) => {
          const list = s.packBuilder[event] ?? [];
          if (list.some((x) => x.id === sound.id)) return s; // no dup
          return { packBuilder: { ...s.packBuilder, [event]: [...list, sound] } };
        }),

      removeFromPackBuilder: (event, idx) =>
        set((s) => {
          const list = (s.packBuilder[event] ?? []).filter((_, i) => i !== idx);
          const next = { ...s.packBuilder };
          if (list.length) next[event] = list;
          else delete next[event];
          return { packBuilder: next };
        }),

      clearPackBuilder: () => set({ packBuilder: {} }),

      setLibrary: (libraryRoot, libraryTree) => set({ libraryRoot, libraryTree }),

      setLibraryPackages: (libraryPackages) => set({ libraryPackages }),

      setPacks: (packs) => set({ packs }),

      setActivePack: (activePackId) => set({ activePackId }),

      updatePack: (pack) =>
        set((s) => ({
          packs: s.packs.map((p) => (p.id === pack.id ? pack : p)),
        })),

      // editor
      setEditorTool: (editorTool) => set({ editorTool }),

      addTrackItem: (item) =>
        set((s) => ({
          trackItems: [...s.trackItems, { ...item, color: item.color || nextColor() }],
          selectedItemId: item.id,
        })),

      updateTrackItem: (id, patch) =>
        set((s) => ({
          trackItems: s.trackItems.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),

      removeTrackItem: (id) =>
        set((s) => ({
          trackItems: s.trackItems.filter((t) => t.id !== id),
          selectedItemId: s.selectedItemId === id ? null : s.selectedItemId,
        })),

      selectItem: (id) => set({ selectedItemId: id }),

      setTimelineZoom: (timelineZoom) => set({ timelineZoom }),

      setPlayheadPos: (playheadPos) => set({ playheadPos }),

      setTrackCount: (trackCount) => set({ trackCount }),

      setMasterVolume: (masterVolume) => set({ masterVolume }),

      gid: "",
      gidDisplayName: "",
      gidSignedIn: false,
      setGidAuth: (p) => set({ gid: p.gid, gidDisplayName: p.displayName, gidSignedIn: p.signedIn }),
    }),
    {
      name: "gann-project",
      version: 1,
      // persist only the project itself (source + clips) — not UI/library state
      partialize: (s) => ({
        sourcePath: s.sourcePath,
        wavPath: s.wavPath,
        duration: s.duration,
        clips: s.clips,
        bannerOverrides: s.bannerOverrides,
        packBuilder: s.packBuilder,
        gmaidenPath: s.gmaidenPath,
        overlayLayout: s.overlayLayout,
        pastOverlayLayouts: s.pastOverlayLayouts,
        futureOverlayLayouts: s.futureOverlayLayouts,
        bannerProject: s.bannerProject,
      }),
    }
  )
);
