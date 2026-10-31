import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { BannerLayer, BannerProject, BannerTransform } from './bannerProject';

export function sampleLayer(layer:BannerLayer,timeMs:number):BannerLayer|null {
 if(!layer.visible||(layer.timing&&(timeMs<layer.timing.startMs||timeMs>layer.timing.endMs)))return null;
 const keys=layer.motion?.keyframes;
 if(!keys?.length)return layer;
 let transform=keys[0].transform;
 if(timeMs>=keys[keys.length-1].timeMs)transform=keys[keys.length-1].transform;
 else for(let i=1;i<keys.length;i++)if(timeMs<=keys[i].timeMs){
  const a=keys[i-1],b=keys[i];let t=Math.max(0,(timeMs-a.timeMs)/(b.timeMs-a.timeMs));
  if(a.easing==='easeInOut')t=t*t*(3-2*t);
  transform=Object.fromEntries(Object.keys(a.transform).map(key=>{const k=key as keyof BannerTransform;return [k,a.transform[k]+(b.transform[k]-a.transform[k])*t];})) as unknown as BannerTransform;break;
 }
 return {...layer,transform};
}

export function validateBannerTimeline(project:BannerProject,videoEndMs:number):void {
 if(!Number.isFinite(videoEndMs)||videoEndMs<=0||videoEndMs>18200)throw new Error('Invalid video timeline');
 if(!Number.isInteger(project.artboard.width)||!Number.isInteger(project.artboard.height)||project.artboard.width<2||project.artboard.height<2||project.artboard.width>1920||project.artboard.height>1080)throw new Error('Artboard maximum 1920×1080');
 for(const asset of project.assets)if(asset.kind==='svg'||asset.mime==='image/svg+xml')throw new Error(`SVG ${asset.id}: rasterize this asset before building`);
 for(const layer of project.layers){
  const valid=(t:BannerTransform)=>Object.values(t).every(Number.isFinite)&&t.width>0&&t.height>0&&t.opacity>=0&&t.opacity<=1;
  if(!valid(layer.transform))throw new Error(`Invalid transform ${layer.id}`);
  if(layer.timing&&(!Number.isFinite(layer.timing.startMs)||!Number.isFinite(layer.timing.endMs)||layer.timing.startMs<0||layer.timing.endMs<layer.timing.startMs||layer.timing.endMs>videoEndMs))throw new Error(`Invalid timing ${layer.id}`);
  let last=-1;
  for(const key of layer.motion?.keyframes??[]){if(!Number.isFinite(key.timeMs)||key.timeMs<=last||key.timeMs>videoEndMs||!valid(key.transform)||!['linear','easeInOut'].includes(key.easing))throw new Error(`Invalid keyframes ${layer.id}`);last=key.timeMs;}
  const seen=new Set([layer.id]);let parentId=layer.parentId;while(parentId){if(seen.has(parentId))throw new Error('Layer hierarchy cycle');seen.add(parentId);const parent=project.layers.find(value=>value.id===parentId);if(!parent||parent.kind!=='group')throw new Error(`Missing group ${parentId}`);parentId=parent.parentId;}
 }
}

function waitForMedia(start:(resolve:()=>void,reject:(error:Error)=>void)=>void,signal?:AbortSignal):Promise<void>{
 return new Promise((resolve,reject)=>{
  let timeout:ReturnType<typeof setTimeout>;const abort=()=>done(new Error('Cancelled'));
  const done=(error?:Error)=>{clearTimeout(timeout);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve();};
  timeout=setTimeout(()=>done(new Error('Media decode exceeded 15 seconds; repair this asset')),15000);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){done(new Error('Cancelled'));return;}start(()=>done(),error=>done(error));
 });
}

async function managedUrl(ref:string,assetPaths:Record<string,string>):Promise<string>{
 const path=ref.startsWith('asset:')?assetPaths[ref.slice(6)]:undefined;
 if(!path)throw new Error(`Missing managed asset ${ref}`);
 return convertFileSrc(path);
}

/** Rasterizes only declarative layers. No source scripts or SVG document are evaluated. */
export async function renderBannerProject(project:BannerProject,videoEndMs:number,assetPaths:Record<string,string>,fps=24,signal?:AbortSignal):Promise<{frames:string[];fps:number}> {
 validateBannerTimeline(project,videoEndMs);
 const media=new Map<string,HTMLImageElement|HTMLVideoElement>(),fonts:FontFace[]=[];
 try{
 for(const asset of project.assets){
  const url=await managedUrl(asset.source,assetPaths);
  if(asset.kind==='video'){
   const video=document.createElement('video');video.muted=true;video.preload='auto';media.set(asset.id,video);
   await waitForMedia((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error(`Cannot decode asset ${asset.id}`));video.src=url;},signal);
  }else{
   const image=new Image();await waitForMedia((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error(`Cannot decode asset ${asset.id}`));image.src=url;},signal);media.set(asset.id,image);
  }
 }
 for(const layer of project.layers)if(layer.style.fontAssetId){
  const path=assetPaths[layer.style.fontAssetId];if(!path)throw new Error(`Missing font ${layer.style.fontAssetId}`);
  const bytes=await invoke<number[]>('read_audio_bytes',{path});
  const font=new FontFace(layer.style.fontFamily||layer.style.fontAssetId,new Uint8Array(bytes));await font.load();document.fonts.add(font);fonts.push(font);
 }
 await document.fonts?.ready;
 const canvas=document.createElement('canvas');canvas.width=project.artboard.width;canvas.height=project.artboard.height;
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas renderer unavailable');
 const frames:string[]=[],count=Math.max(1,Math.ceil(videoEndMs*fps/1000));let encodedBytes=0;
 const layers=[...project.layers].sort((a,b)=>a.order-b.order);
 for(let i=0;i<count;i++){
  if(signal?.aborted)throw new Error('Cancelled');const timeMs=i*1000/fps;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for(const source of layers){
   const layer=sampleLayer(source,timeMs);if(!layer||layer.kind==='group')continue;
   const t=layer.transform,w=t.width*canvas.width/100,h=t.height*canvas.height/100;
   ctx.save();ctx.translate(t.x*canvas.width/100,t.y*canvas.height/100);ctx.rotate(t.rotation*Math.PI/180);ctx.globalAlpha=t.opacity;
   // Ancestor visibility and motion are composed before the child's local transform.
   let parent=source.parentId?layers.find(v=>v.id===source.parentId):undefined;const seen=new Set([source.id]);
   while(parent){if(seen.has(parent.id))throw new Error('Layer hierarchy cycle');seen.add(parent.id);const sampled=sampleLayer(parent,timeMs);if(!sampled){ctx.globalAlpha=0;break;}ctx.globalAlpha*=sampled.transform.opacity;ctx.translate((sampled.transform.x-50)*canvas.width/100,(sampled.transform.y-50)*canvas.height/100);ctx.rotate(sampled.transform.rotation*Math.PI/180);parent=parent.parentId?layers.find(v=>v.id===parent!.parentId):undefined;}
   if(layer.kind==='shape'){ctx.fillStyle=layer.style.fill||'transparent';ctx.fillRect(-w/2,-h/2,w,h);if(layer.style.stroke){ctx.strokeStyle=layer.style.stroke;ctx.strokeRect(-w/2,-h/2,w,h);}}
   else if(layer.kind==='text'){ctx.fillStyle=layer.style.fill||'#fff';ctx.font=`${layer.style.fontWeight||400} ${layer.style.fontSize||32}px "${(layer.style.fontFamily||'Tahoma').replace(/["\\]/g,'')}"`;ctx.textAlign='center';ctx.textBaseline='middle';const lines=(layer.content.text||'').split('\n');lines.forEach((line,n)=>ctx.fillText(line,0,(n-(lines.length-1)/2)*(layer.style.fontSize||32)*1.2,w));}
   else{const image=media.get(layer.content.assetId||'');if(!image)throw new Error(`Missing layer asset ${layer.content.assetId}`);if(image instanceof HTMLVideoElement){const target=Math.min(Math.max(0,(timeMs-(layer.timing?.startMs||0))/1000),Math.max(0,image.duration-.001));if(Math.abs(image.currentTime-target)>.001){await waitForMedia((resolve,reject)=>{image.onseeked=resolve;image.onerror=()=>reject(new Error('Video seek failed'));image.currentTime=target;},signal);}}ctx.drawImage(image,-w/2,-h/2,w,h);}
   ctx.restore();
  }
  const frame=canvas.toDataURL('image/png').split(',')[1];encodedBytes+=frame.length;
  if(encodedBytes>64*1024*1024)throw new Error('Rendered variant exceeds 64 MiB; reduce artboard size');frames.push(frame);
  if(i%12===0)await new Promise(resolve=>setTimeout(resolve,0));
 }
 return {frames,fps};
 }finally{for(const item of media.values())if(item instanceof HTMLVideoElement){item.removeAttribute('src');item.load();}for(const font of fonts)document.fonts.delete(font);}
}
