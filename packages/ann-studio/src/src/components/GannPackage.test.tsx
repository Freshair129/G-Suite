// @vitest-environment jsdom
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { vi, it, expect } from 'vitest';
import GannPackage from './GannPackage';
const {invoke,open}=vi.hoisted(()=>({invoke:vi.fn(),open:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke}));
vi.mock('@tauri-apps/plugin-dialog',()=>({open,save:vi.fn()}));
it('opens a container and resolves each banner to its own indexed voice and video',async()=>{
 URL.createObjectURL=vi.fn(()=>'blob:preview');URL.revokeObjectURL=vi.fn();
 open.mockResolvedValue('D:/test.gann');invoke.mockImplementation((cmd,args)=>cmd==='gann_open'?Promise.resolve({token:'digest',index:{announcer_id:'ann_id',files:[]},registry:{name:'VRZO',revision:4,sounds:[{sound_id:'s1',path:'audio/s1.wav'},{sound_id:'s2',path:'audio/s2.wav'}],banners:[{banner_id:'b1',event_key:'first_blood',playback_sound_id:'s1',visual_source:{video:'video/b1.webm'},config:{duration_seconds:7}},{banner_id:'b2',event_key:'rampage',playback_sound_id:'s2',visual_source:{video:'video/b2.webm'},config:{duration_seconds:6}}]}}):Promise.resolve(new ArrayBuffer(1)));
 render(<GannPackage onClose={()=>{}}/>);fireEvent.click(screen.getByText('เปิด .gann'));
 await screen.findByText(/VRZO · revision 4/);
 await waitFor(()=>expect(invoke).toHaveBeenCalledWith('gann_read',{token:'digest',path:'audio/s1.wav'}));
 fireEvent.change(screen.getByLabelText('Package event'),{target:{value:'b2'}});
 await waitFor(()=>expect(invoke).toHaveBeenCalledWith('gann_read',{token:'digest',path:'audio/s2.wav'}));
 expect(invoke).toHaveBeenCalledWith('gann_read',{token:'digest',path:'video/b2.webm'});
 expect(screen.getByText(/"duration_seconds": 6/)).toBeTruthy();
});
