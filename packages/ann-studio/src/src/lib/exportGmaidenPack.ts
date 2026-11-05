import { invoke } from "@tauri-apps/api/core";
import { useStudioStore, type Pack } from "../store/useStudioStore";
import { snapshotProject, acceptProjectBuild, updateProjectBinding } from "./project";
import { renderBannerProject } from "./renderBannerProject";
import type { ProjectOpenResult, ProjectSnapshot } from "./packProject";

export interface GannBuildReport { [key:string]:unknown; path:string; digest:string; pack_id:string; revision:number; events:number; clips:number; banners:number; artifactId:string; projectFingerprint:string; toolchainFingerprint:string; generation:number; reused:boolean; superseded:boolean }
export interface GannBuildJob { snapshot:ProjectSnapshot; assetPaths:Record<string,string>; sessionToken:string; renders:Array<{variantId:string;frames:string[];fps:number}>;outputPath:string|null }
type Mode="session"|"library"|"event";
type Progress={stage:string;completed:number;total:number};
const listeners=new Set<(progress:Progress)=>void>();
let activeBuild:{controller:AbortController;jobId?:string}|undefined;
export function subscribeBuildProgress(callback:(progress:Progress)=>void){listeners.add(callback);return()=>{listeners.delete(callback);};}
function notify(progress:Progress){for(const listener of listeners)listener(progress);}
export async function cancelCurrentGannBuild():Promise<void>{const active=activeBuild;if(!active)return;active.controller.abort();if(active.jobId)await invoke('cancel_build',{jobId:active.jobId});}

/** All entry points freeze the same complete document. Event selection only chooses preview playback. */
export async function prepareCurrentGannBuild(outputPath?:string,signal?:AbortSignal):Promise<GannBuildJob>{
 const captured=await snapshotProject();
 const prepared=await invoke<ProjectOpenResult>('prepare_project',captured);
 if(!prepared.sessionToken)throw new Error('Project session is missing; reopen the project before building');
 const mapped=new Set(prepared.snapshot.project.eventMappings.flatMap(mapping=>mapping.variantIds));
 if(!mapped.size)throw new Error('ยังไม่มีเสียงที่ map event');
 const renders:GannBuildJob['renders']=[];let encodedBytes=0;
 for(const variant of prepared.snapshot.project.variants){
  if(!mapped.has(variant.id))continue;
  if(signal?.aborted)throw new Error('Cancelled');
  const render=await renderBannerProject(variant.bannerProject,variant.videoEndMs,prepared.assetPaths,24,signal);
  encodedBytes+=render.frames.reduce((total,frame)=>total+frame.length,0);if(encodedBytes>256*1024*1024)throw new Error('Rendered pack exceeds 256 MiB; reduce artboard size');
  renders.push({variantId:variant.id,...render});
 }
 return {...prepared,sessionToken:prepared.sessionToken,renders,outputPath:outputPath??null};
}
export async function buildCurrentGann(_mode:Mode='session',_event?:string,outputPath?:string,_name='ann-pack',_author='',_animate=true,_voiceCaption=true,_reactive=false):Promise<GannBuildReport>{
 if(activeBuild)throw new Error('กำลังสร้างแพ็กอยู่');
 const active={controller:new AbortController(),jobId:undefined as string|undefined};activeBuild=active;
 try{
  notify({stage:'Snapshot',completed:0,total:1});const job=await prepareCurrentGannBuild(outputPath,active.controller.signal);
  if(active.controller.signal.aborted)throw new Error('Cancelled');
  active.jobId=await invoke<string>('start_build',{job});
  if(active.controller.signal.aborted)await invoke('cancel_build',{jobId:active.jobId});
  for(;;){
   const status=await invoke<{state:string;stage:string;completed:number;total:number;report?:GannBuildReport;error?:string}>('build_status',{jobId:active.jobId});
   notify(status);
   if(status.state==='cancelled')throw new Error('Cancelled');if(status.state==='failed')throw new Error(status.error||'Build failed');
   if(status.state==='ready'&&status.report){const report=status.report;const accepted=acceptProjectBuild({...report,originProjectId:job.snapshot.project.projectId,originAnnouncerId:job.snapshot.project.announcerId,generation:report.generation??job.snapshot.generation,projectFingerprint:report.projectFingerprint??job.snapshot.fingerprint},job.snapshot,job.assetPaths);if(accepted===false)report.superseded=true;return report;}
   await new Promise(resolve=>setTimeout(resolve,120));
  }
 }finally{if(activeBuild===active)activeBuild=undefined;}
}
export async function buildSavedPackGann(pack:Pack,outputPath?:string){
 // Explicitly importing a saved library pack makes it the editable source of truth before build.
 const state=useStudioStore.getState();
 const clips=await Promise.all(Object.entries(pack.mappings).map(async([event,m])=>{
  const path=/^(?:[A-Za-z]:[\\/]|\/)/.test(m.sound_path)?m.sound_path:`${state.libraryRoot}/${m.sound_path}`;
  const info=await invoke<{duration_ms:number}>('inspect_media',{path});
  return {id:`saved-${pack.id}-${event}`,event,name:m.sound_name,start:0,end:info.duration_ms/1000,filePath:m.sound_path,color:'#9dff3f',gain:m.volume>0?20*Math.log10(m.volume):-80,speed:m.speed};
 }));
 useStudioStore.setState({clips,packBuilder:{},...(state.projectDocument?{projectDocument:{...state.projectDocument,name:pack.name}}:{})});
 return buildCurrentGann('session',undefined,outputPath,pack.name);
}
export async function installGann(path:string){
 const pack=await invoke<{token:string;index:{announcer_id:string}}>('gann_open',{path});
 const profiles=await invoke<Array<{profile_id:string;display_name:string;instance_kind:string}>>('discover_maiden_profiles');
 if(!profiles.length)throw new Error('เปิด G-Maiden แล้วเลือกติดตั้งจากหน้าสร้างแพ็ก');
 let index=0;
 if(profiles.length===1){if(!window.confirm(`ติดตั้งใน ${profiles[0].display_name} (${profiles[0].instance_kind}) และเปิดใช้หลังจบแมตช์?`))throw new Error('ยกเลิกการติดตั้ง');}
 else {const choice=window.prompt('เลือก G-Maiden เป้าหมาย\n'+profiles.map((p,i)=>`${i+1}. ${p.display_name} · ${p.instance_kind}`).join('\n'));if(choice===null)throw new Error('ยกเลิกการติดตั้ง');index=Number(choice)-1;if(!Number.isInteger(index)||index<0||index>=profiles.length)throw new Error('เลือกเป้าหมายจากหน้าสร้างแพ็ก');}
 const profile=profiles[index],document=useStudioStore.getState().projectDocument;
 const binding=document?.announcerId===pack.index.announcer_id?document.installBindings[profile.profile_id]:undefined;
 const intent=JSON.stringify([document?.projectId,profile.profile_id,pack.token,binding||null,'after_match']);
 const requestId=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(intent))),b=>b.toString(16).padStart(2,'0')).join('');
 const reply=await invoke<{result:{installed:boolean;activation:string;project_binding?:string;artifact:{digest:string}};activation_error?:{code:string}}>('install_gann_package',{job:{path,profileId:profile.profile_id,expectedDigest:pack.token,projectBinding:binding||null,requestId,equipPolicy:'after_match'}});
 if(!reply.result.installed||reply.result.artifact.digest!==pack.token)throw new Error('ผลติดตั้งไม่ตรงกับแพ็ก');
 if(reply.result.project_binding&&document?.announcerId===pack.index.announcer_id){updateProjectBinding(profile.profile_id,reply.result.project_binding);}
 return {...reply.result,pack_id:pack.index.announcer_id,pack_dir:profile.display_name,activated:reply.result.activation==='active',activation_error:reply.activation_error};
}
async function buildAndInstall(mode:Mode,name:string,author:string,animate:boolean,voiceCaption:boolean,reactive:boolean){
 try{const pack=await buildCurrentGann(mode,undefined,undefined,name,author,animate,voiceCaption,reactive);const installed=await installGann(pack.path);const status=installed.activation_error?'ติดตั้งแล้ว แต่เปิดใช้ไม่สำเร็จ: '+installed.activation_error.code:installed.activated?'ติดตั้งและเปิดใช้แล้ว':installed.activation==='deferred_until_match_end'?'ติดตั้งแล้ว รอเปิดใช้หลังจบแมตช์':'ติดตั้งแล้ว ยังไม่เปิดใช้';return `${status} · ${pack.events} events · ${pack.clips} variants\n${installed.pack_dir}`;}catch(e){return `ติดตั้งไม่สำเร็จ: ${e}`;}
}
export function installGmaidenPack(name='ann-pack',author='',animate=true,voiceCaption=true,reactive=false){return buildAndInstall('session',name,author,animate,voiceCaption,reactive);}
export function installLibraryPack(name='ann-pack',author='',animate=true,voiceCaption=true,reactive=false){return buildAndInstall('library',name,author,animate,voiceCaption,reactive);}
