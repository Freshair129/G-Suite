import type { ProjectSnapshot } from "./packProject";
import { OVERLAY_MODULE_IDS } from "./overlayLayout";

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const safe=(value:unknown)=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0;
function need(condition:unknown,detail:string):asserts condition{if(!condition)throw new Error(`Invalid project: ${detail}`);}
const finite=(value:unknown)=>typeof value==="number"&&Number.isFinite(value);
function clip(value:unknown,assets:Set<string>):void{
  need(object(value)&&typeof value.id==="string"&&typeof value.name==="string"&&typeof value.event==="string"&&typeof value.color==="string","clip fields");
  need(finite(value.start)&&finite(value.end)&&Number(value.start)>=0&&Number(value.end)>=Number(value.start),"clip timing");
  for(const key of ["filePath","source"])if(value[key]!==undefined)need(typeof value[key]==="string"&&(value[key] as string).startsWith("asset:")&&assets.has((value[key] as string).slice(6)),"clip asset");
  for(const key of ["gain","speed","fadeIn","fadeOut","gainL","gainR","fileDur"])if(value[key]!==undefined)need(finite(value[key]),"clip tuning");
  if(value.master!==undefined)need(object(value.master)&&Object.values(value.master).every(finite),"clip mastering");
}
function banner(value:unknown,assets:Set<string>):void{
  need(object(value)&&value.schemaVersion===1&&typeof value.id==="string"&&typeof value.title==="string"&&typeof value.eventId==="string"&&safe(value.revision),"banner identity");
  need(object(value.artboard)&&finite(value.artboard.width)&&finite(value.artboard.height)&&Number(value.artboard.width)>0&&Number(value.artboard.height)>0&&["dota-hud","none"].includes(String(value.artboard.safeZonePreset)),"banner artboard");
  need(Array.isArray(value.assets)&&Array.isArray(value.layers)&&value.assets.length<=4096&&value.layers.length<=4096,"banner contents");
  const localAssets=new Set<string>(),layers=new Set<string>();
  for(const asset of value.assets){need(object(asset)&&typeof asset.id==="string"&&!localAssets.has(asset.id)&&typeof asset.name==="string"&&typeof asset.mime==="string"&&["image","svg","video"].includes(String(asset.kind))&&typeof asset.source==="string"&&asset.source.startsWith("asset:")&&assets.has(asset.source.slice(6)),"banner managed asset");localAssets.add(asset.id);}
  for(const layer of value.layers){need(object(layer)&&typeof layer.id==="string"&&!layers.has(layer.id)&&typeof layer.name==="string"&&["group","text","shape","image","svg","video"].includes(String(layer.kind))&&typeof layer.visible==="boolean"&&typeof layer.locked==="boolean"&&finite(layer.order)&&(layer.parentId===null||typeof layer.parentId==="string"),"banner layer");layers.add(layer.id);need(object(layer.transform)&&["x","y","width","height","rotation","opacity"].every(key=>finite((layer.transform as Record<string,unknown>)[key]))&&object(layer.style)&&object(layer.content),"banner transform/style");if(layer.content.text!==undefined)need(typeof layer.content.text==="string","banner caption");if(layer.content.assetId!==undefined)need(typeof layer.content.assetId==="string"&&localAssets.has(layer.content.assetId),"banner layer asset");if(layer.timing!==undefined)need(object(layer.timing)&&safe(layer.timing.startMs)&&safe(layer.timing.endMs),"banner timing");}
  for(const layer of value.layers)need(layer.parentId===null||layers.has(layer.parentId),"banner parent");
}

export function validateProjectSnapshot(value:unknown):asserts value is ProjectSnapshot {
  need(object(value)&&object(value.project),"snapshot");const p=value.project;
  need(p.schemaVersion===2&&typeof p.projectId==="string"&&uuid.test(p.projectId)&&typeof p.announcerId==="string"&&p.announcerId.startsWith("ann_")&&uuid.test(p.announcerId.slice(4)),"identity/schema; import an old project explicitly");
  need(safe(value.generation)&&typeof value.fingerprint==="string"&&safe(p.currentRevision),"generation/revision");
  need(typeof p.name==="string"&&p.name.length<=256&&typeof p.author==="string"&&typeof p.locale==="string","metadata");
  need(object(p.installBindings)&&Object.values(p.installBindings).every(token=>typeof token==="string"&&token.length<=4096),"install bindings");
  for(const field of ["assets","variants","eventMappings","inactiveStock","templates","buildHistory"])need(Array.isArray(p[field]),field);
  need((p.assets as unknown[]).length<=4096,"asset count");const assets=new Set<string>();
  for(const asset of p.assets as unknown[]){need(object(asset)&&typeof asset.id==="string"&&asset.id.length>0&&!assets.has(asset.id),"duplicate asset");assets.add(asset.id);need(typeof asset.relativePath==="string"&&/^assets\/[A-Za-z0-9_.-]+$/.test(asset.relativePath)&&!asset.relativePath.includes(".."),`unsafe asset ${asset.id}`);need(typeof asset.sha256==="string"&&(asset.sha256===""||/^[0-9a-f]{64}$/.test(asset.sha256))&&typeof asset.mediaType==="string"&&object(asset.sourceMetadata)&&typeof asset.sourceMetadata.originalName==="string","asset metadata");}
  const variants=new Set<string>();
  for(const variant of p.variants as unknown[]){need(object(variant)&&typeof variant.id==="string"&&!variants.has(variant.id),"variant identity");variants.add(variant.id);for(const key of ["originalSoundId","mixedSoundId","bannerId","voiceAssetId"])need(typeof variant[key]==="string","variant identifiers");need(assets.has(variant.voiceAssetId as string),`missing asset ${variant.voiceAssetId}`);if(variant.bannerSource!==undefined){const source=variant.bannerSource;need(object(source)&&typeof source.assetId==="string"&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(source.assetId)&&safe(source.revision)&&Number(source.revision)>0&&typeof source.manifestSha256==="string"&&/^[0-9a-f]{64}$/.test(source.manifestSha256),"banner source provenance");}need(Array.isArray(variant.sfxCues),"variant SFX");clip(variant.voiceClip,assets);banner(variant.bannerProject,assets);need(safe(variant.audioEndMs)&&safe(variant.videoEndMs),"timeline");for(const cue of variant.sfxCues){need(object(cue)&&typeof cue.assetId==="string"&&assets.has(cue.assetId),"SFX asset");for(const key of ["startMs","trimStartMs","trimEndMs","fadeInMs","fadeOutMs"])need(safe(cue[key]),"SFX timing");need(typeof cue.gainDb==="number"&&Number.isFinite(cue.gainDb),"SFX gain");}}
  for(const mapping of p.eventMappings as unknown[]){need(object(mapping)&&typeof mapping.eventKey==="string"&&Array.isArray(mapping.variantIds)&&mapping.variantIds.every(id=>typeof id==="string"&&variants.has(id)),"event mapping");}
  need(object(p.editor)&&Array.isArray(p.editor.clips)&&object(p.editor.bannerProject)&&Array.isArray(p.editor.bannerProject.layers)&&Array.isArray(p.editor.bannerProject.assets)&&object(p.editor.bannerOverrides)&&object(p.editor.packBuilder)&&Array.isArray(p.editor.trackItems)&&object(p.editor.overlayLayout),"editor");
  banner(p.editor.bannerProject,assets);for(const value of p.editor.clips)clip(value,assets);
  need(p.editor.bannerVariantId===null||typeof p.editor.bannerVariantId==="string"&&variants.has(p.editor.bannerVariantId),"banner variant ownership");
  need(finite(p.editor.duration)&&Number(p.editor.duration)>=0&&safe(p.editor.trackCount)&&finite(p.editor.masterVolume),"editor timeline");
  for(const id of OVERLAY_MODULE_IDS){const module=p.editor.overlayLayout[id];need(object(module)&&["x","y","scale"].every(key=>finite(module[key]))&&typeof module.enabled==="boolean","overlay layout");}
  for(const sounds of Object.values(p.editor.packBuilder)){need(Array.isArray(sounds),"library sounds");for(const sound of sounds)need(object(sound)&&finite(sound.id)&&typeof sound.name_th==="string"&&typeof sound.name_en==="string"&&typeof sound.file_path==="string"&&sound.file_path.startsWith("asset:")&&assets.has(sound.file_path.slice(6))&&finite(sound.duration),"library sound asset");}
  for(const item of p.editor.trackItems)need(object(item)&&typeof item.id==="string"&&typeof item.filePath==="string"&&item.filePath.startsWith("asset:")&&assets.has(item.filePath.slice(6))&&finite(item.offset)&&finite(item.duration),"track item");
  for(const field of ["sourceAssetId","wavAssetId"])need(p.editor[field]===null||typeof p.editor[field]==="string"&&assets.has(p.editor[field] as string),"source asset");
}
