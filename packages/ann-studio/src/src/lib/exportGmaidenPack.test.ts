// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { useStudioStore } from '../store/useStudioStore';
import { buildCurrentGann, installGann } from './exportGmaidenPack';
const {invoke}=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke}));
beforeEach(()=>{invoke.mockReset();useStudioStore.setState({wavPath:'D:/voice.wav',gmaidenPath:'D:/candidate',clips:[],packBuilder:{},bannerOverrides:{kill:{b64:'authored-image',ext:'png',mime:'image/png'}}});});
it('builds all variants as one GANN request with the authored event image',async()=>{
 useStudioStore.setState({clips:[{id:'one',name:'line one',start:0,end:1,event:'kill',color:''},{id:'two',name:'line two',start:1,end:2,event:'kill',color:''}]});
 invoke.mockImplementation((command,{job})=>{if(command!=='create_gann_package')throw new Error('Event bypassed GANN builder');expect(job.clips.map((c:{name:string})=>c.name)).toEqual(['line one','line two']);expect(job.banners).toEqual([{event:'kill',b64:'authored-image',ext:'png'}]);return Promise.resolve({path:'D:/created.gann',pack_id:'ann_id',events:1,clips:2,banners:2});});
 expect((await buildCurrentGann()).path).toBe('D:/created.gann');
});
it('reports activation failure instead of reporting installation success',async()=>{
 invoke.mockResolvedValue({pack_id:'ann_id',pack_dir:'D:/cache',activated:false});
 await expect(installGann('D:/created.gann')).rejects.toThrow('ยังไม่ได้เปิดใช้');
});
