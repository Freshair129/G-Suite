// @vitest-environment jsdom
import { beforeEach,expect,it,vi } from 'vitest';
import { createPackProject } from './packProject';
import { buildCurrentGann, cancelCurrentGannBuild, subscribeBuildProgress } from './exportGmaidenPack';
const mocks=vi.hoisted(()=>({invoke:vi.fn(),snapshotProject:vi.fn(),render:vi.fn(),accept:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:mocks.invoke}));
vi.mock('./project',()=>({snapshotProject:mocks.snapshotProject,acceptProjectBuild:mocks.accept}));
vi.mock('./renderBannerProject',()=>({renderBannerProject:mocks.render}));
beforeEach(()=>{vi.clearAllMocks();});
it('freezes one project and renders every mapped variant from its own edited layers',async()=>{
 const project=createPackProject();project.name='My project';
 const variant=(id:string,text:string)=>({id,originalSoundId:`snd_${id}`,mixedSoundId:`snd_m${id}`,bannerId:`bnr_${id}`,voiceAssetId:'voice',voiceClip:{id,name:text,start:0,end:1,event:'kill',color:''},bannerProject:{...project.editor.bannerProject,id,title:text},sfxCues:[],audioEndMs:1000,videoEndMs:1000});
 project.variants=[variant('one','คำแรก'),variant('two','คำที่สอง')];project.eventMappings=[{eventKey:'kill',variantIds:['one','two']}];
 const captured={snapshot:{project,generation:4,fingerprint:'draft'},assetPaths:{voice:'D:/voice.wav'}};
 mocks.snapshotProject.mockResolvedValue(captured);mocks.render.mockImplementation(async banner=>({frames:[banner.title],fps:1}));
 mocks.invoke.mockImplementation(async(command,args)=>{
  if(command==='prepare_project')return captured;
  if(command==='start_build'){expect(args.job.snapshot.project.announcerId).toBe(project.announcerId);expect(args.job.renders).toEqual([{variantId:'one',frames:['คำแรก'],fps:1},{variantId:'two',frames:['คำที่สอง'],fps:1}]);return 'job-1';}
  expect(command).toBe('build_status');return {state:'ready',stage:'Commit',completed:1,total:1,report:{path:'D:/created.gann',digest:'a'.repeat(64),revision:1,pack_id:project.announcerId,events:1,clips:2,banners:2}};
 });
 expect((await buildCurrentGann('event','kill')).revision).toBe(1);
 expect(mocks.snapshotProject).toHaveBeenCalledOnce();expect(mocks.render).toHaveBeenCalledTimes(2);
});
it('cancels only its queued native job and never commits a cancelled report',async()=>{
 const project=createPackProject();project.variants=[{id:'one',originalSoundId:'snd_one',mixedSoundId:'snd_mix',bannerId:'bnr_one',voiceAssetId:'voice',voiceClip:{id:'one',name:'line',start:0,end:1,event:'kill',color:''},bannerProject:project.editor.bannerProject,sfxCues:[],audioEndMs:1000,videoEndMs:1000}];project.eventMappings=[{eventKey:'kill',variantIds:['one']}];
 const captured={snapshot:{project,generation:1,fingerprint:'source'},assetPaths:{voice:'D:/voice.wav'}};mocks.snapshotProject.mockResolvedValue(captured);mocks.render.mockResolvedValue({frames:['one'],fps:1});
 mocks.invoke.mockImplementation(async(command,args)=>{if(command==='prepare_project')return captured;if(command==='start_build')return 'my-job';if(command==='cancel_build'){expect(args.jobId).toBe('my-job');return;}if(command==='build_status'){await cancelCurrentGannBuild();return {state:'cancelled',stage:'Audio',completed:0,total:1};}throw new Error(command);});
 const progress=vi.fn(),unsubscribe=subscribeBuildProgress(progress);
 await expect(buildCurrentGann()).rejects.toThrow('Cancelled');unsubscribe();expect(mocks.accept).not.toHaveBeenCalled();expect(progress).toHaveBeenCalledWith(expect.objectContaining({stage:'Audio'}));
});
