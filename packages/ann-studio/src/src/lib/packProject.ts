import { createDefaultBannerProject, type BannerProject } from "./bannerProject";
import { cloneDefaultOverlayLayout, type OverlayLayout } from "./overlayLayout";
import { GMAIDEN_EVENTS } from "../data/gmaiden-events";
import type { Clip, BannerOverride, LibSound, TrackItem } from "../store/useStudioStore";

export interface Asset { id:string; relativePath:string; sha256:string; mediaType:string; sourceMetadata:{originalName:string} }
export interface SfxCue { assetId:string; startMs:number; gainDb:number; trimStartMs:number; trimEndMs:number; fadeInMs:number; fadeOutMs:number }
export interface BannerSource { assetId:string; revision:number; manifestSha256:string }
export interface Variant { id:string; originalSoundId:string; mixedSoundId:string; bannerId:string; voiceAssetId:string; voiceClip:Clip; bannerProject:BannerProject; bannerSource?:BannerSource; sfxCues:SfxCue[]; audioEndMs:number; videoEndMs:number }
export interface EventMapping { eventKey:string; variantIds:string[] }
export interface ProjectTemplate { id:string; version:string; fontFamily?:string; assetIds:string[] }
export interface ProjectBuild { revision:number; digest:string; artifactId:string; projectFingerprint:string; toolchainFingerprint:string; [key:string]:unknown }
export interface ProjectEditor {
  sourceAssetId:string|null; wavAssetId:string|null; duration:number; clips:Clip[]; bannerProject:BannerProject; bannerVariantId:string|null;
  bannerOverrides:Record<string,BannerOverride>; packBuilder:Record<string,LibSound[]>; trackItems:TrackItem[]; trackCount:number; masterVolume:number; overlayLayout:OverlayLayout;
}
export interface PackProject { schemaVersion:2; projectId:string; announcerId:string; name:string; author:string; locale:string; installBindings:Record<string,string>; currentRevision:number; assets:Asset[]; variants:Variant[]; eventMappings:EventMapping[]; inactiveStock:string[]; templates:ProjectTemplate[]; buildHistory:ProjectBuild[]; editor:ProjectEditor }
export interface ProjectSnapshot { project:PackProject; generation:number; fingerprint:string }
export interface ProjectOpenResult { snapshot:ProjectSnapshot; assetPaths:Record<string,string>; sessionToken?:string|null }
export interface ProjectSaveResult extends ProjectOpenResult { path:string; sessionToken:string }
export interface EditorState { sourcePath:string|null; wavPath:string|null; duration:number; clips:Clip[]; bannerProject:BannerProject; bannerVariantId:string|null; bannerOverrides:Record<string,BannerOverride>; packBuilder:Record<string,LibSound[]>; trackItems:TrackItem[]; trackCount:number; masterVolume:number; overlayLayout:OverlayLayout; selectedClipId:string|null; libraryRoot:string }

const id=(prefix="")=>`${prefix}${crypto.randomUUID()}`;
const clone=<T>(value:T):T=>structuredClone(value);
const absolute=(path:string)=>/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(path);
const filename=(path:string)=>path.replace(/\\/g,"/").split("/").pop()||"asset";
const join=(root:string,path:string)=>absolute(path)||path.startsWith("data:")?path:`${root}/${path}`;

export function createPackProject():PackProject {
  return {schemaVersion:2,projectId:id(),announcerId:id("ann_"),name:"Untitled pack",author:"",locale:"th-TH",installBindings:{},currentRevision:0,assets:[],variants:[],eventMappings:[],inactiveStock:[],templates:[],buildHistory:[],editor:{sourceAssetId:null,wavAssetId:null,duration:0,clips:[],bannerProject:createDefaultBannerProject(),bannerVariantId:null,bannerOverrides:{},packBuilder:{},trackItems:[],trackCount:3,masterVolume:1,overlayLayout:cloneDefaultOverlayLayout()}};
}

export function duplicatePackProject(project:PackProject):PackProject {
  const copy=clone(project);copy.projectId=id();copy.announcerId=id("ann_");copy.currentRevision=0;copy.buildHistory=[];copy.installBindings={};
  for(const variant of copy.variants){variant.originalSoundId=id("snd_");variant.mixedSoundId=id("snd_");variant.bannerId=id("bnr_");}
  return copy;
}

export function captureProject(document:PackProject,state:EditorState,knownPaths:Record<string,string>):{project:PackProject;assetPaths:Record<string,string>} {
  const project=clone(document),assetPaths={...knownPaths};
  const manage=(path:string|null|undefined):string|null=>{
    if(!path)return null;
    if(path.startsWith("asset:"))return path.slice(6);
    if(/^https?:\/\/asset\.localhost\//.test(path))path=decodeURIComponent(path.replace(/^https?:\/\/asset\.localhost\//,""));
    const found=Object.entries(assetPaths).find(([,value])=>value===path)?.[0];if(found)return found;
    const assetId=id("asset_");assetPaths[assetId]=path;
    const originalName=path.startsWith("data:")?"embedded-media":filename(path);
    const extension=/\.([a-z0-9]{1,8})$/i.exec(originalName)?.[1]?.toLowerCase()||"bin";
    const mediaType=path.startsWith("data:")?path.slice(5,path.indexOf(";")):extension==="wav"?"audio/wav":extension==="mp3"?"audio/mpeg":extension==="woff2"?"font/woff2":extension==="ttf"?"font/ttf":`application/octet-stream`;
    project.assets.push({id:assetId,relativePath:`assets/${assetId}.${extension}`,sha256:"",mediaType,sourceMetadata:{originalName}});return assetId;
  };
  const reference=(path:string|undefined,library=false):string|undefined=>path?`asset:${manage(library?join(state.libraryRoot,path):path)}`:undefined;
  const banner=(input:BannerProject)=>{const result=clone(input);for(const asset of result.assets)asset.source=reference(asset.source)!;return result;};
  const sourceAssetId=manage(state.sourcePath),wavAssetId=manage(state.wavPath);
  const clips=state.clips.map(clip=>({...clone(clip),filePath:reference(clip.filePath,true),source:reference(clip.source)}));
  const libraryClips=Object.entries(state.packBuilder).flatMap(([event,sounds])=>sounds.map(sound=>({id:`library-${sound.id}-${event}`,name:sound.name_th||sound.name_en,start:0,end:sound.duration,event,color:"#9dff3f",filePath:`asset:${manage(join(state.libraryRoot,sound.file_path))}`,fileDur:sound.duration,source:reference(sound.source_path)} satisfies Clip)));
  const allClips:Clip[]=[...clips,...libraryClips];
  project.variants=allClips.map(clip=>{
    const prior=document.variants.find(v=>v.id===clip.id);
    const audioEndMs=Math.max(1,Math.round((clip.end-clip.start)*1000/(clip.speed||1)));
    const visual=banner(prior&&state.bannerVariantId!==clip.id?prior.bannerProject:state.bannerProject);
    if(!prior&&(state.bannerVariantId!==clip.id||visual.layers[1]?.content.text==="DOUBLE KILL")){const caption=visual.layers.find(layer=>layer.kind==="text");if(caption)caption.content.text=clip.name;visual.eventId=clip.event;visual.title=clip.name;}
    return {...(prior?clone(prior):{id:clip.id,originalSoundId:id("snd_"),mixedSoundId:id("snd_"),bannerId:id("bnr_"),sfxCues:[],audioEndMs,videoEndMs:audioEndMs}),voiceAssetId:clip.filePath?.slice(6)||wavAssetId||"",voiceClip:clip,bannerProject:visual};
  });
  const supported=new Set(GMAIDEN_EVENTS.filter(e=>e.id!=="unused").map(e=>e.id));
  project.eventMappings=[];project.inactiveStock=[];
  for(const variant of project.variants){const event=variant.voiceClip.event;if(!supported.has(event)){project.inactiveStock.push(variant.id);continue;}let mapping=project.eventMappings.find(m=>m.eventKey===event);if(!mapping){mapping={eventKey:event,variantIds:[]};project.eventMappings.push(mapping);}mapping.variantIds.push(variant.id);}
  const packBuilder=clone(state.packBuilder);for(const sounds of Object.values(packBuilder))for(const sound of sounds){sound.file_path=reference(sound.file_path,true)!;sound.source_path=reference(sound.source_path)||"";}
  project.editor={sourceAssetId,wavAssetId,duration:state.duration,clips,bannerProject:banner(state.bannerProject),bannerVariantId:project.variants.some(variant=>variant.id===state.bannerVariantId)?state.bannerVariantId:null,bannerOverrides:clone(state.bannerOverrides),packBuilder,trackItems:state.trackItems.map(item=>({...clone(item),filePath:reference(item.filePath,true)!})),trackCount:state.trackCount,masterVolume:state.masterVolume,overlayLayout:clone(state.overlayLayout)};
  return {project,assetPaths};
}

export function resolveProjectEditor(project:PackProject,assetPaths:Record<string,string>):EditorState {
  const path=(assetId:string|null)=>{if(!assetId)return null;const value=assetPaths[assetId];if(!value)throw new Error(`Missing asset ${assetId}: เลือกไฟล์เพื่อซ่อมแซม`);return value;};
  const first=Object.values(assetPaths)[0]?.replace(/\\/g,"/")||"";
  const libraryRoot=first.slice(0,first.lastIndexOf("/"));
  const restore=(ref:string|undefined,relative=false)=>{if(!ref)return ref;const value=ref.startsWith("asset:")?path(ref.slice(6))!:ref;return relative&&value.replace(/\\/g,"/").startsWith(`${libraryRoot}/`)?value.replace(/\\/g,"/").slice(libraryRoot.length+1):value;};
  const banner=(input:BannerProject)=>{const value=clone(input);for(const asset of value.assets)asset.source=restore(asset.source)!;return value;};
  const editor=clone(project.editor);
  for(const sounds of Object.values(editor.packBuilder))for(const sound of sounds){sound.file_path=restore(sound.file_path,true)!;sound.source_path=restore(sound.source_path)||"";}
  return {sourcePath:path(editor.sourceAssetId),wavPath:path(editor.wavAssetId),duration:editor.duration,clips:editor.clips.map(clip=>({...clip,filePath:restore(clip.filePath,true),source:restore(clip.source)})),bannerProject:banner(editor.bannerProject),bannerVariantId:editor.bannerVariantId,bannerOverrides:editor.bannerOverrides,packBuilder:editor.packBuilder,trackItems:editor.trackItems.map(item=>({...item,filePath:restore(item.filePath,true)!})),trackCount:editor.trackCount,masterVolume:editor.masterVolume,overlayLayout:editor.overlayLayout,selectedClipId:null,libraryRoot};
}
