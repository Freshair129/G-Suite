import { create } from "zustand";

export interface Clip {
  id: string;
  name: string;
  start: number;
  end: number;
  event: string;
  color: string;
}

export type AppView = "studio" | "profile" | "settings";

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
  name: string;
  file_path: string;
  duration: number;
  event: string;
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
  selectedClipId: string | null;
  model: string;
  transcribing: boolean;
  provider: "ollama" | "claude";
  llmModel: string;

  view: AppView;
  gmaidenConnected: boolean;
  gmaidenPath: string;
  voiceCache: VoiceCacheMap;

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
  setModel: (model: string) => void;
  setTranscribing: (v: boolean) => void;
  setProvider: (p: "ollama" | "claude") => void;
  setLlmModel: (m: string) => void;
  setView: (v: AppView) => void;
  setGMaiden: (connected: boolean, path: string, cache: VoiceCacheMap) => void;
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

export const useStudioStore = create<StudioState>((set) => ({
  sourcePath: null,
  wavPath: null,
  duration: 0,
  clips: [],
  selectedClipId: null,
  model: "medium",
  transcribing: false,
  provider: "ollama",
  llmModel: "",

  view: "studio",
  gmaidenConnected: false,
  gmaidenPath: "",
  voiceCache: {},

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
    set({ sourcePath: source, wavPath: wav, duration, clips: [], selectedClipId: null }),

  addClip: (clip) =>
    set((s) => ({
      clips: [...s.clips, { ...clip, color: clip.color || nextColor() }],
      selectedClipId: clip.id,
    })),

  updateClip: (id, patch) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),

  removeClip: (id) =>
    set((s) => ({
      clips: s.clips.filter((c) => c.id !== id),
      selectedClipId: s.selectedClipId === id ? null : s.selectedClipId,
    })),

  selectClip: (id) => set({ selectedClipId: id }),

  setClips: (clips) => set({ clips }),

  setModel: (model) => set({ model }),

  setTranscribing: (transcribing) => set({ transcribing }),

  setProvider: (provider) => set({ provider }),

  setLlmModel: (llmModel) => set({ llmModel }),

  setView: (view) => set({ view }),

  setGMaiden: (gmaidenConnected, gmaidenPath, voiceCache) =>
    set({ gmaidenConnected, gmaidenPath, voiceCache }),

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
}));
