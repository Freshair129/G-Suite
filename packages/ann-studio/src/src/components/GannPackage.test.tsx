// @vitest-environment jsdom
import { render, fireEvent, screen, waitFor, cleanup, act } from '@testing-library/react';
import { vi, it, expect, afterEach, beforeEach } from 'vitest';
import GannPackage from './GannPackage';
const {invoke,open}=vi.hoisted(()=>({invoke:vi.fn(),open:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke}));
vi.mock('@tauri-apps/plugin-dialog',()=>({open,save:vi.fn()}));
afterEach(cleanup);
beforeEach(()=>{vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});});
it('opens a container and resolves each banner to its own indexed voice and video',async()=>{
 URL.createObjectURL=vi.fn(()=>'blob:preview');URL.revokeObjectURL=vi.fn();
 open.mockResolvedValue('D:/test.gann');invoke.mockImplementation((cmd,args)=>cmd==='gann_open'?Promise.resolve({token:'digest',index:{announcer_id:'ann_id',files:[]},registry:{name:'VRZO',revision:4,events:{first_blood:[{sound_id:'o1',banner_id:'b1'}],rampage:[{sound_id:'o2',banner_id:'b2'}]},sounds:[{sound_id:'s1',path:'audio/s1.wav'},{sound_id:'s2',path:'audio/s2.wav'}],banners:[{banner_id:'b1',event_key:'first_blood',original_sound_id:'o1',playback_sound_id:'s1',visual_source:{video:'video/b1.webm'},config:{duration_seconds:7}},{banner_id:'b2',event_key:'rampage',original_sound_id:'o2',playback_sound_id:'s2',visual_source:{video:'video/b2.webm'},config:{duration_seconds:6}}]}}):Promise.resolve(new ArrayBuffer(1)));
 render(<GannPackage onClose={()=>{}}/>);fireEvent.click(screen.getByText('เปิด .gann'));
 await screen.findByText(/VRZO · revision 4/);
 await waitFor(()=>expect(invoke).toHaveBeenCalledWith('gann_read',{token:'digest',path:'audio/s1.wav'}));
 fireEvent.change(screen.getByLabelText('Package event'),{target:{value:'b2'}});
 await waitFor(()=>expect(invoke).toHaveBeenCalledWith('gann_read',{token:'digest',path:'audio/s2.wav'}));
 expect(invoke).toHaveBeenCalledWith('gann_read',{token:'digest',path:'video/b2.webm'});
 expect(screen.getByText(/"duration_seconds": 6/)).toBeTruthy();
});

it('event preview only exposes pairs referenced by registry.events', async () => {
 URL.createObjectURL=vi.fn(()=>'blob:preview');URL.revokeObjectURL=vi.fn();
 open.mockResolvedValue('D:/test.gann');
 invoke.mockImplementation((cmd)=>cmd==='gann_open'?Promise.resolve({token:'digest2',index:{announcer_id:'ann_id',files:[]},registry:{name:'Paired',revision:1,sounds:[{sound_id:'s1',path:'audio/s1.wav'},{sound_id:'s2',path:'audio/s2.wav'}],events:{first_blood:[{sound_id:'o1',banner_id:'b1'}]},banners:[{banner_id:'b2',event_key:'rampage',original_sound_id:'o2',playback_sound_id:'s2',visual_source:{video:'video/b2.webm'},config:{duration_seconds:3}},{banner_id:'b1',event_key:'first_blood',original_sound_id:'o1',playback_sound_id:'s1',visual_source:{video:'video/b1.webm'},config:{duration_seconds:2}}]}}):Promise.resolve(new ArrayBuffer(1)));
 const view=render(<GannPackage onClose={()=>{}}/>);fireEvent.click(view.getByText('เปิด .gann'));
 await view.findByText(/Paired · revision 1/);
 expect((view.getByLabelText('Package event') as HTMLSelectElement).value).toBe('b1');
 expect(view.queryByText('rampage · b2')).toBeNull();
 view.unmount();
});

it('ignores an old play rejection after selecting a replacement event',async()=>{
 URL.createObjectURL=vi.fn(()=>'blob:preview');URL.revokeObjectURL=vi.fn();open.mockResolvedValue('D:/test.gann');
 invoke.mockImplementation((command)=>command==='gann_open'?Promise.resolve({token:'race',index:{announcer_id:'ann_id',files:[]},registry:{name:'Race',revision:1,sounds:[{sound_id:'s1',path:'audio/s1.wav'},{sound_id:'s2',path:'audio/s2.wav'}],events:{first_blood:[{sound_id:'o1',banner_id:'b1'}],rampage:[{sound_id:'o2',banner_id:'b2'}]},banners:[{banner_id:'b1',event_key:'first_blood',original_sound_id:'o1',playback_sound_id:'s1',visual_source:{video:'video/b1.webm'},config:{duration_seconds:3}},{banner_id:'b2',event_key:'rampage',original_sound_id:'o2',playback_sound_id:'s2',visual_source:{video:'video/b2.webm'},config:{duration_seconds:3}}]}}):Promise.resolve(new ArrayBuffer(1)));
 let rejectOld!:(error:Error)=>void;let count=0;vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(()=>++count===1?new Promise<void>((_,reject)=>{rejectOld=reject;}):Promise.resolve());
 const view=render(<GannPackage onClose={()=>{}}/>);fireEvent.click(view.getByText('เปิด .gann'));await view.findByText(/Race · revision 1/);
 const play=view.getByText('เล่นภาพพร้อมเสียง') as HTMLButtonElement;await waitFor(()=>expect(play.disabled).toBe(false));fireEvent.click(play);
 fireEvent.change(view.getByLabelText('Package event'),{target:{value:'b2'}});await waitFor(()=>expect(play.disabled).toBe(false));fireEvent.click(play);
 const pauses=vi.mocked(HTMLMediaElement.prototype.pause).mock.calls.length;
 await act(async()=>{rejectOld(new Error('old playback aborted'));await Promise.resolve();});
 expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.calls.length).toBe(pauses);expect(view.queryByText(/old playback aborted/)).toBeNull();
});

it('natural completion preserves the paired voice and configured visual tail',async()=>{
 URL.createObjectURL=vi.fn(()=>'blob:preview');URL.revokeObjectURL=vi.fn();open.mockResolvedValue('D:/test.gann');
 invoke.mockImplementation((command)=>command==='gann_open'?Promise.resolve({token:'tail',index:{announcer_id:'ann_id',files:[]},registry:{name:'Tail',revision:1,sounds:[{sound_id:'s1',path:'audio/s1.wav'}],events:{first_blood:[{sound_id:'o1',banner_id:'b1'}]},banners:[{banner_id:'b1',event_key:'first_blood',original_sound_id:'o1',playback_sound_id:'s1',visual_source:{video:'video/b1.webm'},config:{duration_seconds:3}}]}}):Promise.resolve(new ArrayBuffer(1)));
 const view=render(<GannPackage onClose={()=>{}}/>);fireEvent.click(view.getByText('เปิด .gann'));await waitFor(()=>expect(view.container.querySelector('audio')).not.toBeNull());
 const audio=view.container.querySelector('audio')!,video=view.container.querySelector('video')!;const stopVoice=vi.spyOn(audio,'pause');
 fireEvent.ended(video);expect(stopVoice).not.toHaveBeenCalled();video.currentTime=3;fireEvent.timeUpdate(video);expect(stopVoice).not.toHaveBeenCalled();
 const stopVisual=vi.spyOn(video,'pause');stopVisual.mockClear();video.currentTime=2;fireEvent.ended(audio);expect(stopVisual).not.toHaveBeenCalled();
});
