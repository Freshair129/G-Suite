import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useStudioStore } from '../store/useStudioStore';
import { saveProject, openProject, newProject, updateProjectMetadata, selectProjectVariant, updateVariant, addProjectAsset, updateProjectBinding, snapshotProject, recoverProject, importLegacyProject } from '../lib/project';
import { buildCurrentGann, cancelCurrentGannBuild, subscribeBuildProgress } from '../lib/exportGmaidenPack';
import { beginBuild, finishBuild, failBuild, markDraft, canUseArtifact, initialBuildState } from '../lib/buildState';
import { importProjectMedia } from "../lib/importMedia";
import SourceView from './SourceView';
import BannerEditor from './BannerEditor';
import EventPicker from './EventPicker';
import GannPackage from './GannPackage';

const steps=['โปรเจกต์','นำเข้าสื่อ','จับคู่เหตุการณ์','ภาพและ SFX','สร้างและทดสอบ','ใช้แพ็ก'];
type Profile={profile_id:string;display_name:string;instance_kind:string};
type InstallReply={result:{installed:boolean;activation:'inactive'|'active'|'deferred_until_match_end';project_binding?:string;artifact:{digest:string}};activation_error?:{code:string;safe_detail?:string}};
const button='rounded border border-line px-3 py-2 text-sm disabled:opacity-40 hover:border-lime';

export default function PackWorkflow() {
  const state=useStudioStore();
  const [step,setStep]=useState(0);
  const [name,setName]=useState(state.projectDocument?.name || 'My Announcer');
  const [author,setAuthor]=useState(state.projectDocument?.author || '');
  const [build,setBuild]=useState(initialBuildState);
  const [profiles,setProfiles]=useState<Profile[]>([]);
  const [profile,setProfile]=useState('');
  const [equip,setEquip]=useState('after_match');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [preview,setPreview]=useState(false);
  const [progress,setProgress]=useState<{stage:string;completed:number;total:number}|null>(null);
  const [keyTime,setKeyTime]=useState(0);
  useEffect(()=>subscribeBuildProgress(setProgress),[]);
  const request=useRef(0);
  const projectOwner=useRef(state.projectDocument?.projectId);
  useEffect(()=>{const owner=state.projectDocument?.projectId;if(projectOwner.current&&projectOwner.current!==owner){request.current++;setBuild(initialBuildState);setPreview(false);}projectOwner.current=owner;},[state.projectDocument?.projectId]);
  useEffect(()=>{setName(state.projectDocument?.name || 'My Announcer');setAuthor(state.projectDocument?.author || '');},[state.projectDocument?.projectId]);
  function fingerprint() {
    const s=useStudioStore.getState();
    return JSON.stringify([s.projectDocument?.projectId,name,author,s.projectGeneration]);
  }
  const token=fingerprint();
  const currentToken=useRef(token); currentToken.current=token;
  useEffect(()=>{setBuild(b=>markDraft(b,token));},[token]);
  async function perform(action:()=>Promise<void>){setBusy(true);setError('');try{await action();}catch(e){setError(String(e));}finally{setBusy(false);}}
  async function refreshProfiles(){const list=await invoke<Profile[]>('discover_maiden_profiles');setProfiles(list);setProfile(p=>list.some(x=>x.profile_id===p)?p:list.length===1?list[0].profile_id:'');}
  useEffect(()=>{void refreshProfiles().catch(()=>setProfiles([]));},[]);
  async function importMedia(){await perform(async()=>{
    const path=await open({title:'นำเข้าเสียงหรือวิดีโอ',filters:[{name:'Media',extensions:['wav','mp3','flac','ogg','mp4','webm','m4a']}]});
    if(!path || typeof path!=='string')return;
    if(state.clips.length && !window.confirm('นำเข้าสื่อใหม่จะแทนที่คลิปปัจจุบัน บันทึกโปรเจกต์แล้วหรือยัง?'))return;
    await importProjectMedia(path);
    setMessage('นำเข้าแล้ว ตัดช่วงเสียงและเลือกเหตุการณ์สำหรับแต่ละคลิป');
  });}
  async function createPack(){
    const id=String(++request.current);
    setError('');
    try{
      updateProjectMetadata({name,author});
      setBuild(b=>beginBuild(b,id,fingerprint()));
      await snapshotProject();
      if(String(request.current)!==id)return;
      const before=fingerprint();
      setBuild(b=>beginBuild(b,id,before));
      const artifact=await buildCurrentGann('session',undefined,undefined,name,author);
      setBuild(b=>finishBuild(b,id,artifact,fingerprint()));
    }catch(e){setBuild(b=>failBuild(b,id,String(e)));setError(String(e));}
  }
  async function exportPack(){if(!canUseArtifact(build)||!build.artifact)return;const artifact=build.artifact;const sourceToken=currentToken.current;await perform(async()=>{
    const destination=await save({title:'ส่งออกแพ็กที่ทดสอบ',defaultPath:name+'.gann',filters:[{name:'G-Ann Package',extensions:['gann']}]});
    if(sourceToken!==currentToken.current)throw new Error('โปรเจกต์เปลี่ยนแล้ว กรุณาเลือกแพ็กที่จะส่งออกใหม่');
    if(destination){await invoke('export_gann_artifact',{path:artifact.path,expectedDigest:artifact.digest,destination});setMessage('ส่งออกไฟล์เดียวกับที่สร้างและทดสอบแล้ว');}
  });}
  async function installPack(){if(!canUseArtifact(build)||!build.artifact||!profile)return;const artifact=build.artifact;await perform(async()=>{
    const document=useStudioStore.getState().projectDocument;
    const binding=document?.installBindings?.[profile];
    const intent=JSON.stringify([document?.projectId,profile,artifact.digest,binding||null,equip]);
    const requestId=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(intent))),b=>b.toString(16).padStart(2,'0')).join('');
    const reply=await invoke<InstallReply>('install_gann_package',{job:{path:artifact.path,expectedDigest:artifact.digest,profileId:profile,projectBinding:binding||null,requestId,equipPolicy:equip}});
    if(reply.result.artifact.digest!==artifact.digest || !reply.result.installed)throw new Error('ผลติดตั้งไม่ตรงกับแพ็กที่เลือก');
    if(reply.result.project_binding&&useStudioStore.getState().projectDocument?.projectId===document?.projectId)updateProjectBinding(profile,reply.result.project_binding);
    setMessage(reply.activation_error?'ติดตั้งแล้ว แต่ยังเปิดใช้ไม่สำเร็จ: '+reply.activation_error.code:reply.result.activation==='active'?'ติดตั้งและเปิดใช้แล้ว':reply.result.activation==='deferred_until_match_end'?'ติดตั้งแล้ว รอเปิดใช้เมื่อจบแมตช์และเสียงปัจจุบัน':'ติดตั้งแล้ว ยังไม่ได้เปิดใช้');
  });}
  const variant=state.projectDocument?.variants.find(v=>v.voiceClip.id===state.selectedClipId);
  const selectedLayer=state.bannerProject.layers.find(l=>l.id===state.selectedBannerLayerIds[0]);
  function keyframe(preset=false){
    if(!selectedLayer||!variant)return;
    const base=structuredClone(selectedLayer.transform);
    const keys=preset?[{timeMs:0,transform:{...base,opacity:0,y:Math.min(100,base.y+5)},easing:'easeInOut' as const},{timeMs:Math.min(500,variant.videoEndMs),transform:base,easing:'linear' as const}]:[...(selectedLayer.motion?.keyframes||[]).filter(k=>k.timeMs!==keyTime),{timeMs:keyTime,transform:base,easing:'easeInOut' as const}].sort((a,b)=>a.timeMs-b.timeMs);
    state.setBannerProject({...state.bannerProject,layers:state.bannerProject.layers.map(l=>l.id===selectedLayer.id?{...l,motion:{keyframes:keys}}:l)});
  }
  async function addFont(){if(!selectedLayer)return;const owner=state.projectDocument?.projectId;await perform(async()=>{
    const path=await open({title:'เลือกฟอนต์',filters:[{name:'Font',extensions:['ttf','otf','woff2']}]});if(typeof path!=='string')return;
    if(useStudioStore.getState().projectDocument?.projectId!==owner)throw new Error('โปรเจกต์เปลี่ยนแล้ว');
    const asset=await addProjectAsset(path,'font');
    const live=useStudioStore.getState();
    live.setBannerProject({...live.bannerProject,layers:live.bannerProject.layers.map(l=>l.id===selectedLayer.id?{...l,style:{...l.style,fontFamily:asset.id,fontAssetId:asset.id}}:l)});
  });}
  async function addSfx(){if(!variant)return;const owner=state.projectDocument?.projectId;await perform(async()=>{
    const path=await open({title:'เลือกเสียง SFX',filters:[{name:'Audio',extensions:['wav','mp3','flac','ogg']}]});
    if(typeof path!=='string')return;
    const info=await invoke<{duration_ms:number}>('inspect_media',{path});
    if(!Number.isFinite(info.duration_ms)||info.duration_ms<=0)throw new Error('อ่านความยาว SFX ไม่สำเร็จ');
    if(useStudioStore.getState().projectDocument?.projectId!==owner)throw new Error('โปรเจกต์เปลี่ยนแล้ว');
    const asset=await addProjectAsset(path,'audio');
    updateVariant(variant.id,{sfxCues:[...variant.sfxCues,{assetId:asset.id,startMs:0,gainDb:0,trimStartMs:0,trimEndMs:info.duration_ms,fadeInMs:0,fadeOutMs:0}]});
  });}
  const cueEnd=variant?Math.max(0,...variant.sfxCues.map(c=>c.startMs+c.trimEndMs-c.trimStartMs)):0;
  return <main className="flex flex-1 min-w-0 min-h-0 flex-col gap-3 p-4" aria-label="สร้าง Announcer Pack">
    <nav className="flex flex-wrap gap-2" aria-label="ขั้นตอนสร้างแพ็ก">{steps.map((label,i)=><button className={button+(step===i?' border-lime text-lime':'')} key={label} onClick={()=>setStep(i)}>{i+1}. {label}</button>)}</nav>
    <p className="text-xs text-ink-muted">สร้างและใช้แพ็กในเครื่องได้โดยไม่ต้องลงชื่อเข้าใช้</p>
    {state.projectRecoveryError && <p role="alert" className="text-red-300">{state.projectRecoveryError}</p>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {message && <p role="status" className="text-lime">{message}</p>}
    <section className="flex flex-1 min-h-0 flex-col gap-3 overflow-auto">
    {step===0 && <>
      <h1 className="text-xl font-bold">โปรเจกต์ Announcer</h1>
      <label>ชื่อแพ็ก<input aria-label="ชื่อแพ็ก" className="block rounded bg-panel border border-line p-2" value={name} onChange={e=>{setName(e.target.value);updateProjectMetadata({name:e.target.value});}}/></label>
      <label>ผู้สร้าง<input aria-label="ผู้สร้าง" className="block rounded bg-panel border border-line p-2" value={author} onChange={e=>{setAuthor(e.target.value);updateProjectMetadata({author:e.target.value});}}/></label>
      <p>บันทึก .ann เพื่อเก็บเสียงต้นฉบับ ภาพ เลเยอร์ และการจับคู่เหตุการณ์สำหรับแก้ไขต่อ</p>
      <div className="flex gap-2"><button className={button} onClick={()=>{if(!state.clips.length||window.confirm('บันทึกงานปัจจุบันก่อนสร้างโปรเจกต์ใหม่แล้วหรือยัง?')){newProject();setBuild(initialBuildState);}}}>โปรเจกต์ใหม่</button><button className={button} onClick={()=>void perform(async()=>setMessage(await openProject()))}>เปิดโปรเจกต์</button><button className={button} onClick={()=>void perform(async()=>setMessage(await saveProject()))}>บันทึกโปรเจกต์</button></div>
    </>}
    {step===0 && <div className="flex gap-2"><button className={button} disabled={busy} onClick={()=>void perform(async()=>setMessage(await recoverProject()))}>กู้คืนงาน</button><button className={button} disabled={busy} onClick={()=>void perform(async()=>setMessage(await importLegacyProject()))}>นำเข้าโปรเจกต์เก่า</button><button className={button} disabled={busy} onClick={()=>void perform(async()=>setMessage(await saveProject(true)))}>บันทึกโปรเจกต์เป็น</button></div>}
    {step===1 && <><button className={button} disabled={busy} onClick={()=>void importMedia()}>นำเข้าสื่อ</button><SourceView/></>}
    {step===2 && <><h2>จับคู่เหตุการณ์และตัวเลือกเสียง</h2><p>คลิปที่ยังไม่จับคู่เก็บเป็น stock และจะไม่ถูกเล่นแทนเหตุการณ์อื่น</p>{state.clips.map(c=><div key={c.id} className="flex gap-3 items-center"><span className="w-52 truncate">{c.name}</span><EventPicker value={c.event} onChange={event=>state.updateClip(c.id,{event})}/></div>)}</>}
    {step===3 && <>
      <select aria-label="คลิปที่แก้ภาพ" className="rounded bg-panel p-2" value={state.selectedClipId||''} onChange={e=>selectProjectVariant(e.target.value)}><option value="">เลือกคลิป</option>{state.clips.map(c=><option key={c.id} value={c.id}>{c.name} · {c.event}</option>)}</select>
      <div className="flex gap-2"><button className={button} disabled={!variant||busy} onClick={()=>void addSfx()}>เพิ่ม SFX</button>{variant&&<label>ความยาวเสียง (ms)<input type="number" min="1" max="15000" value={variant.audioEndMs} onChange={e=>{const n=Number(e.target.value);updateVariant(variant.id,{audioEndMs:n,videoEndMs:Math.max(n,variant.videoEndMs)});}}/></label>}</div>
      {variant&&<label>ภาพต่อหลังเสียง (ms)<input type="number" min="0" max="3200" value={variant.videoEndMs-variant.audioEndMs} onChange={e=>updateVariant(variant.id,{videoEndMs:variant.audioEndMs+Number(e.target.value)})}/></label>}
      {variant&&cueEnd>variant.audioEndMs&&<div role="alert"><p>SFX เลยช่วงเสียง กรุณาเลือกขยายช่วงหรือตัด SFX</p><button className={button} disabled={cueEnd>15000} onClick={()=>updateVariant(variant.id,{audioEndMs:cueEnd,videoEndMs:Math.max(cueEnd,variant.videoEndMs)})}>ขยายช่วงเสียง</button><button className={button} onClick={()=>updateVariant(variant.id,{sfxCues:variant.sfxCues.filter(c=>c.startMs<variant.audioEndMs).map(c=>({...c,trimEndMs:Math.min(c.trimEndMs,c.trimStartMs+variant.audioEndMs-c.startMs)}))})}>ตัดและลบ SFX นอกช่วง</button></div>}
      {selectedLayer&&variant&&<div className="flex gap-2 items-center"><span>โมชั่น: {selectedLayer.name}</span><button className={button} disabled={busy||selectedLayer.kind!=="text"} onClick={()=>void addFont()}>เพิ่มฟอนต์</button><label>เวลา keyframe (ms)<input type="number" min="0" max={variant.videoEndMs} value={keyTime} onChange={e=>setKeyTime(Number(e.target.value))}/></label><button className={button} onClick={()=>keyframe()}>บันทึกตำแหน่งเลเยอร์ ณ เวลานี้</button><button className={button} onClick={()=>keyframe(true)}>ค่อยปรากฏจากด้านล่าง</button><button className={button} onClick={()=>state.setBannerProject({...state.bannerProject,layers:state.bannerProject.layers.map(l=>l.id===selectedLayer.id?{...l,motion:undefined}:l)})}>ล้างโมชั่น</button></div>}
      {variant?.sfxCues.map((cue,i)=><div className="flex gap-2" key={i}><span>SFX {i+1}</span><label>เริ่ม (ms)<input type="number" min="0" value={cue.startMs} onChange={e=>updateVariant(variant.id,{sfxCues:variant.sfxCues.map((c,j)=>j===i?{...c,startMs:Number(e.target.value)}:c)})}/></label><label>ตัดต้น (ms)<input type="number" min="0" value={cue.trimStartMs} onChange={e=>updateVariant(variant.id,{sfxCues:variant.sfxCues.map((c,j)=>j===i?{...c,trimStartMs:Number(e.target.value)}:c)})}/></label><label>ตัดจบ (ms)<input type="number" min="1" value={cue.trimEndMs} onChange={e=>updateVariant(variant.id,{sfxCues:variant.sfxCues.map((c,j)=>j===i?{...c,trimEndMs:Number(e.target.value)}:c)})}/></label><label>Fade in (ms)<input type="number" min="0" value={cue.fadeInMs} onChange={e=>updateVariant(variant.id,{sfxCues:variant.sfxCues.map((c,j)=>j===i?{...c,fadeInMs:Number(e.target.value)}:c)})}/></label><label>Fade out (ms)<input type="number" min="0" value={cue.fadeOutMs} onChange={e=>updateVariant(variant.id,{sfxCues:variant.sfxCues.map((c,j)=>j===i?{...c,fadeOutMs:Number(e.target.value)}:c)})}/></label><label>Gain (dB)<input type="number" value={cue.gainDb} onChange={e=>updateVariant(variant.id,{sfxCues:variant.sfxCues.map((c,j)=>j===i?{...c,gainDb:Number(e.target.value)}:c)})}/></label><button onClick={()=>updateVariant(variant.id,{sfxCues:variant.sfxCues.filter((_,j)=>j!==i)})}>ลบ</button></div>)}
      <BannerEditor onOpenHudLayout={()=>state.setView('overlay')}/>
    </>}
    {step===4 && <>
      <h2>สร้างและทดสอบแพ็กจริง</h2><p>การทดสอบอ่านคู่เสียงและภาพจาก .gann ที่ตรวจแล้ว</p>
      <button className={button} disabled={build.phase==='building'||!name.trim()} onClick={()=>void createPack()}>{build.phase==='building'?'กำลังสร้างแพ็ก…':'สร้างและตรวจแพ็ก'}</button>
      {build.phase==='building'&&<><p role="status">กำลังสร้างแพ็ก {progress?`${progress.completed}/${progress.total}`:''}</p><button className={button} onClick={()=>{request.current++;if(build.requestId)setBuild(b=>failBuild(b,build.requestId!,'Cancelled'));setMessage('ยกเลิกการสร้างแล้ว');void cancelCurrentGannBuild().catch(e=>setError(String(e)));}}>ยกเลิกการสร้าง</button></>}
      {build.artifact && <p>revision {build.artifact.revision} · {build.artifact.events} events · {build.artifact.clips} variants</p>}
      {build.phase==='outdated' && <p>โปรเจกต์เปลี่ยนแล้ว กดสร้างแพ็กใหม่ก่อนทดสอบหรือใช้งาน</p>}
      <button className={button} disabled={!canUseArtifact(build)} onClick={()=>setPreview(true)}>ทดสอบแพ็ก</button>
    </>}
    {step===5 && <>
      <h2>ส่งออกและติดตั้ง</h2><button className={button} disabled={!canUseArtifact(build)||busy} onClick={()=>void exportPack()}>ส่งออก .gann</button>
      <div className="flex gap-2"><select aria-label="G-Maiden เป้าหมาย" className="bg-panel p-2 rounded" value={profile} onChange={e=>setProfile(e.target.value)}><option value="">เลือก G-Maiden</option>{profiles.map(p=><option key={p.profile_id} value={p.profile_id}>{p.display_name} · {p.instance_kind}</option>)}</select><button className={button} disabled={busy} onClick={()=>void perform(refreshProfiles)}>ค้นหาใหม่</button></div>
      {!profiles.length && <p>เปิด G-Maiden แล้วกดค้นหาใหม่ หรือส่งออก .gann เพื่อใช้บนเครื่องอื่น</p>}
      <select aria-label="เปิดใช้แพ็กเมื่อใด" className="bg-panel p-2 rounded" value={equip} onChange={e=>setEquip(e.target.value)}><option value="never">ติดตั้งอย่างเดียว</option><option value="now_if_idle">เปิดใช้เมื่อไม่มีแมตช์</option><option value="after_match">เปิดใช้หลังจบแมตช์ปัจจุบัน</option></select>
      <button className={button} disabled={!canUseArtifact(build)||!profile||busy} onClick={()=>void installPack()}>ติดตั้งใน G-Maiden</button>
    </>}
    </section>
    {preview&&build.artifact&&<GannPackage initialPath={build.artifact.path} onClose={()=>setPreview(false)}/>}
  </main>;
}
