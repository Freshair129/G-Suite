import { invoke } from "@tauri-apps/api/core";
import { useStudioStore, type Clip, type Pack } from "../store/useStudioStore";
import { drawToneBanner, BANNER_W, BANNER_H } from "./toneBanner";
import { clipEnvelope } from "./peaks";

export interface GannBuildReport { path:string; pack_id:string; events:number; clips:number; banners:number }
type Mode="session"|"library"|"event";
type AuthoredClip=Partial<Clip>&{name:string;start:number;end:number;event:string;filePath?:string};
function frames(event:string,caption:string|undefined,animate:boolean,env:number[]|undefined) {
 const count=env?.length?48:animate?12:1;
 return Array.from({length:count},(_,i)=>{
  const canvas=document.createElement('canvas');canvas.width=BANNER_W*2;canvas.height=BANNER_H*2;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('สร้างภาพแพ็กไม่สำเร็จ');ctx.scale(2,2);
  const progress=count===1?1:i/(count-1);
  drawToneBanner(ctx,event,animate?Math.min(1,progress*4):1,caption,env?.length?{env,head:progress}:undefined);
  return canvas.toDataURL('image/png').split(',')[1];
 });
}
async function build(clips:AuthoredClip[],name:string,author:string,outputPath?:string,animate=true,voiceCaption=true,reactive=false):Promise<GannBuildReport>{
 const s=useStudioStore.getState();if(!clips.length)throw new Error('ยังไม่มีเสียงที่ map event');
 const events=[...new Set(clips.map(c=>c.event))];
 const banners=await Promise.all(events.map(async event=>{
  const override=s.bannerOverrides[event];if(override)return {event,b64:override.b64,ext:override.ext};
  const clip=clips.find(c=>c.event===event)!;let env:number[]|undefined;
  if(reactive){const source=clip.filePath?`${s.libraryRoot}/${clip.filePath}`:s.wavPath;if(!source)throw new Error('ไม่พบเสียงต้นฉบับ');env=await clipEnvelope(source,clip.start,clip.end,clip.fileDur??s.duration);}
  const rendered=frames(event,voiceCaption?clip.name:undefined,animate,env);
  return {event,b64:rendered[0],ext:'png',frames:rendered,fps:env?.length?Math.min(60,rendered.length/Math.max(.1,clip.end-clip.start)):24};
 }));
 return invoke<GannBuildReport>('create_gann_package',{job:{name,author,sourcePath:s.wavPath??'',clips:clips.map(c=>({...c,filePath:c.filePath??''})),banners,outputPath:outputPath??null}});
}
export async function buildCurrentGann(mode:Mode='session',event?:string,outputPath?:string,name='ann-pack',author='',animate=true,voiceCaption=true,reactive=false){
 const s=useStudioStore.getState();
 const session=s.clips.filter(c=>c.event&&c.event!=='unused'&&(!event||c.event===event));
 const library=Object.entries(s.packBuilder).flatMap(([ev,sounds])=>(!event||event===ev)?sounds.map(sound=>({name:sound.name_th||sound.name_en,start:0,end:sound.duration,event:ev,filePath:sound.file_path,fileDur:sound.duration})):[]);
 const clips=mode==='session'?session:mode==='library'?library:library.length?library:session;
 return build(clips,name,author,outputPath,animate,voiceCaption,reactive);
}
export async function buildSavedPackGann(pack:Pack,outputPath?:string){
 const clips=Object.entries(pack.mappings).map(([event,m])=>({event,name:m.sound_name,start:0,end:0,filePath:m.sound_path,gain:m.volume>0?20*Math.log10(m.volume):-80,speed:m.speed}));
 return build(clips,pack.name,'',outputPath);
}
export async function installGann(path:string){
 const s=useStudioStore.getState();
 const result=await invoke<{pack_id:string;pack_dir:string;activated:boolean}>('install_gann_package',{job:{path,gmaidenDir:s.gmaidenPath||null,activate:true}});
 if(!result.activated)throw new Error('ติดตั้งแพ็กแล้ว แต่ยังไม่ได้เปิดใช้ใน runtime');
 return result;
}
async function buildAndInstall(mode:Mode,name:string,author:string,animate:boolean,voiceCaption:boolean,reactive:boolean){
 try{const pack=await buildCurrentGann(mode,undefined,undefined,name,author,animate,voiceCaption,reactive);const installed=await installGann(pack.path);return `ติดตั้งและเปิดใช้ GANN แล้ว ✅ ${pack.events} events · ${pack.clips} คู่เสียง/ภาพ\n${installed.pack_dir}`;}catch(e){return `ติดตั้งไม่สำเร็จ: ${e}`;}
}
export function installGmaidenPack(name='ann-pack',author='',animate=true,voiceCaption=true,reactive=false){return buildAndInstall('session',name,author,animate,voiceCaption,reactive);}
export function installLibraryPack(name='ann-pack',author='',animate=true,voiceCaption=true,reactive=false){return buildAndInstall('library',name,author,animate,voiceCaption,reactive);}
