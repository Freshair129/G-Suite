import { describe, expect, it } from 'vitest';
import { beginBuild, finishBuild, failBuild, markDraft, initialBuildState, canUseArtifact } from './buildState';

const artifact = {path:'C:/fixture.gann',digest:'a'.repeat(64),pack_id:'ann_test',revision:1,events:2,clips:3,banners:3};
describe('creator build lifecycle', () => {
  it('uses a completed artifact only for the tested source snapshot', () => {
    const pending = beginBuild(initialBuildState, 'request1', 'draft1');
    expect(canUseArtifact(pending)).toBe(false);
    const ready = finishBuild(pending, 'request1', artifact, 'draft1');
    expect(canUseArtifact(ready)).toBe(true);
    expect(markDraft(ready,'draft2').phase).toBe('outdated');
    expect(canUseArtifact(markDraft(ready,'draft2'))).toBe(false);
  });
  it('marks a build outdated when the document changes during work', () => {
    const state = finishBuild(beginBuild(initialBuildState,'r','first'),'r',artifact,'second');
    expect(state.phase).toBe('outdated');
    expect(canUseArtifact(state)).toBe(false);
  });
  it('ignores delayed completion and errors from a superseded build', () => {
    const state = beginBuild(beginBuild(initialBuildState,'old','first'),'new','second');
    expect(finishBuild(state,'old',artifact,'first')).toBe(state);
    expect(failBuild(state,'old','error')).toBe(state);
  });
  it('keeps a last artifact on failure without labelling it current', () => {
    const ready = finishBuild(beginBuild(initialBuildState,'one','first'),'one',artifact,'first');
    const failed = failBuild(beginBuild(ready,'two','second'),'two','disk full');
    expect(failed.artifact).toEqual(artifact);
    expect(failed.phase).toBe('failed');
    expect(canUseArtifact(failed)).toBe(false);
  });
  it('does not accept an empty or invalid digest as a usable artifact', () => {
    expect(canUseArtifact(finishBuild(beginBuild(initialBuildState,'r','first'),'r',{...artifact,digest:''},'first'))).toBe(false);
  });
  it('never enables an artifact rejected by native project acceptance', () => {
    const state=finishBuild(beginBuild(initialBuildState,'r','same'),'r',{...artifact,superseded:true},'same');
    expect(state.phase).toBe('outdated');
    expect(canUseArtifact(state)).toBe(false);
  });
});
