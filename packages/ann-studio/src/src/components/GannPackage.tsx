import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
type Banner={banner_id:string;event_key:string;playback_sound_id:string;visual_source:{video:string};config:Record<string,unknown>};
type Pack={token:string;index:{announcer_id:string;files:{path:string}[]};registry:{name:string;revision:number;sounds:{sound_id:string;path:string}[];banners:Banner[]}};
export default function GannPackage({onClose,initialPath}:{onClose:()=>void;initialPath?:string}){
 const [pack,setPack]=useState<Pack|null>(null),[selected,setSelected]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[urls,setUrls]=useState<{audio:string;video:string}|null>(null);
 const video=useRef<HTMLVideoElement>(null),audio=useRef<HTMLAudioElement>(null),generation=useRef(0);
 const banner=pack?.registry.banners.find(b=>b.banner_id===selected);
 async function loadPath(path:string){const next=await invoke<Pack>('gann_open',{path});setPack(next);setSelected(next.registry.banners[0]?.banner_id??'');}
 useEffect(()=>{if(initialPath)void loadPath(initialPath).catch(e=>setError(String(e)));},[initialPath]);
 async function load(){setBusy(true);setError('');try{const path=await open({title:'เปิด Announcer Package',filters:[{name:'G-Ann Package',extensions:['gann']}]});if(typeof path!=='string')return;
  await loadPath(path);
 }catch(e){setError(String(e))}finally{setBusy(false)}}
 useEffect(()=>{const g=++generation.current;setUrls(null);setError('');if(!pack||!banner)return;
  const sound=pack.registry.sounds.find(s=>s.sound_id===banner.playback_sound_id);if(!sound){setError('ไม่พบเสียงของแบนเนอร์');return}
  let created:{audio:string;video:string}|undefined;
  Promise.all([invoke<ArrayBuffer>('gann_read',{token:pack.token,path:sound.path}),invoke<ArrayBuffer>('gann_read',{token:pack.token,path:banner.visual_source.video})]).then(([a,v])=>{
   if(g!==generation.current)return;created={audio:URL.createObjectURL(new Blob([a],{type:'audio/wav'})),video:URL.createObjectURL(new Blob([v],{type:'video/webm'}))};setUrls(created);
  }).catch(e=>{if(g===generation.current)setError(String(e))});
  return()=>{generation.current++;if(created){URL.revokeObjectURL(created.audio);URL.revokeObjectURL(created.video)}};
 },[pack,banner]);
 async function play(){if(!video.current||!audio.current)return;try{video.current.currentTime=0;audio.current.currentTime=0;await Promise.all([video.current.play(),audio.current.play()]);}catch(e){video.current?.pause();audio.current?.pause();setError(String(e))}}
 async function copy(){if(!pack)return;setBusy(true);try{const path=await save({title:'บันทึกสำเนาแพ็ก',defaultPath:pack.index.announcer_id+'.gann',filters:[{name:'G-Ann Package',extensions:['gann']}]});if(path)await invoke('gann_save_copy',{token:pack.token,path});}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <div role="dialog" aria-label="G-Ann Package" className="fixed inset-4 z-50 rounded-xl border border-line bg-base text-ink p-5 flex flex-col gap-4 shadow-2xl">
  <div className="flex gap-3 items-center"><h2 className="text-xl font-bold flex-1">Announcer Package</h2><button onClick={()=>void load()} disabled={busy} className="px-4 py-2 border border-line rounded">เปิด .gann</button><button onClick={()=>void copy()} disabled={!pack||busy} className="px-4 py-2 border border-line rounded">บันทึกสำเนา</button><button onClick={onClose} className="px-4 py-2 border border-line rounded">ปิด</button></div>
  {error&&<p role="alert" className="text-red-400">{error}</p>}
  {!pack?<p>เปิดไฟล์แพ็กเพื่อดูเสียง แบนเนอร์ โมชั่น และ config โดยไม่ทับโปรเจกต์ที่กำลังทำอยู่</p>:<>
   <p>{pack.registry.name} · revision {pack.registry.revision} · {pack.registry.sounds.length} เสียง · {pack.registry.banners.length} แบนเนอร์</p><p className="text-xs text-ink-faint">{pack.index.announcer_id} · Local package · SHA-256 verified</p>
   <div className="flex gap-3"><select aria-label="Package event" value={selected} onChange={e=>setSelected(e.target.value)} className="bg-panel border border-line rounded p-2 flex-1">{pack.registry.banners.map(b=><option key={b.banner_id} value={b.banner_id}>{b.event_key} · {b.banner_id}</option>)}</select><button disabled={!urls} onClick={()=>void play()} className="px-4 py-2 bg-lime text-black rounded">เล่นภาพพร้อมเสียง</button></div>
   <div className="flex-1 min-h-0 grid grid-cols-2 gap-4"><div className="bg-panel rounded flex items-center justify-center">{urls&&<><video ref={video} src={urls.video} muted playsInline preload="auto" className="w-full" onError={()=>setError('เล่นวิดีโอไม่สำเร็จ')}/><audio ref={audio} src={urls.audio} preload="auto" onError={()=>setError('เล่นเสียงไม่สำเร็จ')}/></>}</div><pre className="text-xs overflow-auto bg-panel p-4 rounded">{JSON.stringify(banner?.config,null,2)}</pre></div>
   <p className="text-xs text-ink-faint">โมชั่นที่ใช้เล่นอยู่ในวิดีโอ ส่วนต้นฉบับและฟอนต์เก็บใน motion/ ของแพ็ก เปิดตรวจได้โดยไม่รันสคริปต์จากไฟล์นำเข้า</p>
  </>}
 </div>
}
