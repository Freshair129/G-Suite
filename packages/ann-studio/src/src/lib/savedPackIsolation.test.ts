// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { buildSavedPackGann } from './exportGmaidenPack';
import { createPackProject } from './packProject';
import { useStudioStore, type Pack } from '../store/useStudioStore';
const { invoke } = vi.hoisted(() => ({invoke: vi.fn()}));
vi.mock('@tauri-apps/api/core', () => ({invoke}));
vi.mock('./renderBannerProject', () => ({renderBannerProject: async () => ({frames: ['frame'], fps: 1})}));
const pack: Pack = {id:'B',name:'Library B',pack_type:'single',created_at:'',updated_at:'',events:['kill'],
  mappings:{kill:{sound_path:'b.wav',sound_name:'B voice',volume:1,speed:1}}};

it.each([false, true])('exports a library pack separately from the editor (build fails = %s)', async fails => {
  const project = createPackProject();
  project.name = 'Project A';
  useStudioStore.setState({projectDocument:project, projectPath:'A.ann', projectSessionToken:'active-token',
    libraryRoot:'D:/ProjectA/assets', clips:[{id:'clip-A',name:'A',event:'kill',start:0,end:1,color:''}]});
  const before = useStudioStore.getState();
  invoke.mockImplementation(async (cmd, args) => {
    if (cmd === 'init_library') return {root:'D:/library'};
    if (cmd === 'inspect_media') { expect(args.path).toBe('D:/library/b.wav'); return {duration_ms:500}; }
    if (cmd === 'start_build') {
      expect(args.detached).toBe(true);
      expect(args.job.sessionToken).toBe('');
      expect(args.job.snapshot.project.projectId).not.toBe(project.projectId);
      expect(args.job.snapshot.project.name).toBe('Library B');
      expect(Object.values(args.job.assetPaths)).toContain('D:/library/b.wav');
      return 'job-B';
    }
    if (cmd === 'build_status') return fails ? {state:'failed',error:'disk full'} :
      {state:'ready',report:{path:'B.gann',generation:1}};
    throw new Error(cmd);
  });
  const result = buildSavedPackGann(pack, 'B.gann');
  if (fails) await expect(result).rejects.toThrow('disk full');
  else await expect(result).resolves.toMatchObject({path:'B.gann'});
  expect(useStudioStore.getState()).toBe(before);
});
