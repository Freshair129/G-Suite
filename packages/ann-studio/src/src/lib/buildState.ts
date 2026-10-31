export interface CreatorArtifact {
  path: string;
  digest: string;
  pack_id: string;
  revision: number;
  events: number;
  clips: number;
  banners: number;
  superseded?: boolean;
}

export interface CreatorBuildState {
  phase: 'idle' | 'building' | 'ready' | 'outdated' | 'failed';
  requestId?: string;
  sourceFingerprint?: string;
  artifact?: CreatorArtifact;
  error?: string;
}
export const initialBuildState: CreatorBuildState = {phase:'idle'};
export function beginBuild(state: CreatorBuildState, requestId: string, sourceFingerprint: string): CreatorBuildState {
  return {phase:'building', requestId, sourceFingerprint, artifact:state.artifact};
}
export function finishBuild(state: CreatorBuildState, requestId: string, artifact: CreatorArtifact, currentFingerprint: string): CreatorBuildState {
  if (state.requestId !== requestId || state.phase !== 'building') return state;
  return {...state, artifact, phase:!artifact.superseded && state.sourceFingerprint === currentFingerprint ? 'ready' : 'outdated'};
}
export function failBuild(state: CreatorBuildState, requestId: string, error: string): CreatorBuildState {
  if (state.requestId !== requestId || state.phase !== 'building') return state;
  return {...state, phase:'failed', error};
}
export function markDraft(state: CreatorBuildState, currentFingerprint: string): CreatorBuildState {
  if (state.phase !== 'ready' || state.sourceFingerprint === currentFingerprint) return state;
  return {...state, phase:'outdated'};
}
export function canUseArtifact(state: CreatorBuildState): boolean {
  return state.phase === 'ready' && !!state.artifact?.path && /^[a-f0-9]{64}$/.test(state.artifact.digest);
}
