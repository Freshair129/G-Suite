import { create } from "zustand";

export interface Clip {
  id: string;
  name: string;
  start: number;
  end: number;
  event: string;
  color: string;
}

interface StudioState {
  sourcePath: string | null;
  wavPath: string | null;
  duration: number;
  clips: Clip[];
  selectedClipId: string | null;

  setSource: (source: string, wav: string, duration: number) => void;
  addClip: (clip: Clip) => void;
  updateClip: (id: string, patch: Partial<Clip>) => void;
  removeClip: (id: string) => void;
  selectClip: (id: string | null) => void;
  setClips: (clips: Clip[]) => void;
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

export const useStudioStore = create<StudioState>((set) => ({
  sourcePath: null,
  wavPath: null,
  duration: 0,
  clips: [],
  selectedClipId: null,

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
}));
