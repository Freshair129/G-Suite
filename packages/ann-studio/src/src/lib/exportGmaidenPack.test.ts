// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { createPackProject } from './packProject';
import { useStudioStore } from '../store/useStudioStore';
import { buildCurrentGann, installGann } from './exportGmaidenPack';
const {invoke,snapshot,render}=vi.hoisted(()=>({invoke:vi.fn(),snapshot:vi.fn(),render:vi.fn()}));
vi.mock('./project',()=>({snapshotProject:snapshot,acceptProjectBuild:vi.fn()}));
vi.mock('./renderBannerProject',()=>({renderBannerProject:render}));
vi.mock('@tauri-apps/api/core',()=>({invoke}));
beforeEach(()=>{invoke.mockReset();useStudioStore.setState({wavPath:'D:/voice.wav',gmaidenPath:'D:/candidate',clips:[],packBuilder:{},bannerOverrides:{kill:{b64:'authored-image',ext:'png',mime:'image/png'}}});});
it('builds every variant through the shared immutable project job',async()=>{
 const project=createPackProject();
 project.variants=['one','two'].map(id=>({id,originalSoundId:`snd_${id}`,mixedSoundId:`snd_mix_${id}`,bannerId:`bnr_${id}`,voiceAssetId:'voice',voiceClip:{id,name:`line ${id}`,start:0,end:1,event:'kill',color:''},bannerProject:{...project.editor.bannerProject,id},sfxCues:[],audioEndMs:1000,videoEndMs:1000}));
 project.eventMappings=[{eventKey:'kill',variantIds:['one','two']}];
 const captured={snapshot:{project,generation:1,fingerprint:'source'},assetPaths:{voice:'D:/voice.wav'}};snapshot.mockResolvedValue(captured);render.mockImplementation(async p=>({frames:[p.id],fps:1}));
 invoke.mockImplementation(async(command,args)=>{
  if(command==='prepare_project')return captured;
  if(command==='start_build'){expect(args.job.snapshot.project.announcerId).toBe(project.announcerId);expect(args.job.renders.map((v:{variantId:string})=>v.variantId)).toEqual(['one','two']);return 'queued';}
  if(command==='build_status')return {state:'ready',stage:'Commit',completed:1,total:1,report:{path:'D:/created.gann',digest:'a'.repeat(64),revision:1,pack_id:project.announcerId,events:1,clips:2,banners:2,artifactId:'artifact',generation:1,projectFingerprint:'source',toolchainFingerprint:'tools',reused:false,superseded:false}};
  throw new Error('Unexpected command '+command);
 });
 expect((await buildCurrentGann('event','kill')).path).toBe('D:/created.gann');expect(render).toHaveBeenCalledTimes(2);
});
it('reports an installed pack even when activation fails',async()=>{
 vi.stubGlobal('crypto',{subtle:{digest:async()=>new Uint8Array(32).buffer}});vi.spyOn(window,'confirm').mockReturnValue(true);
 const digest='a'.repeat(64);
 invoke.mockImplementation(async command=>{
  if(command==='gann_open')return {token:digest,index:{announcer_id:'ann_fixture'}};
  if(command==='discover_maiden_profiles')return [{profile_id:'test',display_name:'Test Maiden',instance_kind:'test'}];
  if(command==='install_gann_package')return {result:{installed:true,activation:'inactive',artifact:{digest}},activation_error:{code:'runtime_busy'}};
  throw new Error(command);
 });
 const result=await installGann('D:/created.gann');
 expect(result.installed).toBe(true);expect(result.activated).toBe(false);expect(result.activation_error?.code).toBe('runtime_busy');
 vi.unstubAllGlobals();vi.restoreAllMocks();
});
it('rejects an installation result for different bytes',async()=>{
 vi.stubGlobal('crypto',{subtle:{digest:async()=>new Uint8Array(32).buffer}});vi.spyOn(window,'confirm').mockReturnValue(true);
 invoke.mockImplementation(async command=>{
  if(command==='gann_open')return {token:'a'.repeat(64),index:{announcer_id:'ann_fixture'}};
  if(command==='discover_maiden_profiles')return [{profile_id:'test',display_name:'Test Maiden',instance_kind:'test'}];
  return {result:{installed:true,activation:'active',artifact:{digest:'b'.repeat(64)}}};
 });
 await expect(installGann('D:/created.gann')).rejects.toThrow('ผลติดตั้งไม่ตรงกับแพ็ก');
 vi.unstubAllGlobals();vi.restoreAllMocks();
});
