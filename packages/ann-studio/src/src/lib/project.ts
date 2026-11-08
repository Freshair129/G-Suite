import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { confirm, save, open } from "@tauri-apps/plugin-dialog";
import { validateBannerAssetManifest, type BannerAssetManifest } from "@g-suite/banner-contracts";
import { useStudioStore } from "../store/useStudioStore";
import { captureProject, createPackProject, duplicatePackProject, resolveProjectEditor, type Asset, type PackProject, type ProjectBuild, type ProjectOpenResult, type ProjectSaveResult, type Variant } from "./packProject";
import { validateProjectSnapshot } from "./projectValidation";

let hydrating=false;
let documentSession=0;
export interface RecoveryCandidate { id:string; projectId:string; kind:"active"|"history"; name:string; generation:number; fingerprint:string }
export interface RecoveryListing { candidates:RecoveryCandidate[]; warnings:{id:string|null;message:string}[]; truncated:boolean }
let recoveryPicker:((listing:RecoveryListing)=>Promise<string|null>)|null=null;
export function registerRecoveryPicker(picker:(listing:RecoveryListing)=>Promise<string|null>):()=>void {
  recoveryPicker=picker;
  return ()=>{if(recoveryPicker===picker)recoveryPicker=null;};
}
async function selectRecoveryCandidate(listing:RecoveryListing):Promise<string|null> {
  if(!listing.candidates.length)return null;
  if(recoveryPicker)return recoveryPicker(listing);
  return listing.candidates.length===1?listing.candidates[0].id:null;
}
function isNative():boolean{return typeof window!=="undefined"&&"__TAURI_INTERNALS__" in window;}
function origin(){const current=useStudioStore.getState().projectDocument;return {session:documentSession,projectId:current?.projectId??null,announcerId:current?.announcerId??null};}
function sameOrigin(expected:ReturnType<typeof origin>):boolean{const current=origin();return current.session===expected.session&&current.projectId===expected.projectId&&current.announcerId===expected.announcerId;}
const changedProject="โปรเจกต์เปลี่ยนแล้ว — ไม่ใช้ผลลัพธ์กับโปรเจกต์ที่เปิดอยู่";
let recoveryTimer:ReturnType<typeof setTimeout>|undefined;
useStudioStore.subscribe((state,prior)=>{
  if(hydrating)return;
  const keys=["sourcePath","wavPath","duration","clips","bannerProject","bannerOverrides","packBuilder","trackItems","trackCount","masterVolume","overlayLayout","projectDocument"] as const;
  if(keys.some(key=>state[key]!==prior[key])){
    useStudioStore.setState({projectGeneration:state.projectGeneration+1});
    if(isNative()){
      clearTimeout(recoveryTimer);
      recoveryTimer=setTimeout(()=>{const expected=origin();void snapshotProject().then(async captured=>{if(!sameOrigin(expected))return;const prepared=await invoke<ProjectOpenResult>("prepare_project",captured);if(syncPreparedProject(prepared,expected,captured.snapshot.generation))useStudioStore.setState({projectRecoveryError:null});}).catch(error=>{if(sameOrigin(expected))useStudioStore.setState({projectRecoveryError:String(error)});});},5000);
    }
  }
});

function document():PackProject {
  let value=useStudioStore.getState().projectDocument;
  if(!value){value=createPackProject();useStudioStore.setState({projectDocument:value,recentProjectId:value.projectId});}
  return value;
}

function canonical(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;
  if(value&&typeof value==="object")return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export async function projectFingerprint(project:PackProject):Promise<string> {
  const content={...project,currentRevision:0,buildHistory:[],installBindings:{}};
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical(content)));
  return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,"0")).join("");
}

export async function snapshotProject(){
  const current=document(),state=useStudioStore.getState();
  const captured=captureProject(current,state,state.projectAssetPaths);
  hydrating=true;
  try{useStudioStore.setState({projectDocument:captured.project,projectAssetPaths:captured.assetPaths});}
  finally{hydrating=false;}
  const fingerprint=await projectFingerprint(captured.project);
  const result={snapshot:{project:captured.project,generation:state.projectGeneration,fingerprint},assetPaths:captured.assetPaths,sessionToken:state.projectSessionToken};
  if(isNative()&&!state.projectSessionToken){
    const expected=origin(),generation=state.projectGeneration;
    useStudioStore.setState({projectTransitionPending:true});
    try{
      const activated=await invoke<ProjectOpenResult>("activate_project_session",{snapshot:result.snapshot,assetPaths:result.assetPaths,expectedSessionToken:null});
      if(!activated.sessionToken)throw new Error("Native project activation returned no session token");
      if(!sameOrigin(expected)||useStudioStore.getState().projectGeneration!==generation)throw new Error(changedProject);
      if(!syncPreparedProject(activated,expected,generation))throw new Error(changedProject);
    }finally{useStudioStore.setState({projectTransitionPending:false});}
    return snapshotProject();
  }
  return result;
}

async function activateInspectedProject(result:ProjectOpenResult,path:string,expected:ReturnType<typeof origin>,generation:number):Promise<boolean>{
  if(!sameOrigin(expected)||useStudioStore.getState().projectGeneration!==generation)return false;
  validateProjectSnapshot(result.snapshot);
  if(!isNative()){hydrateProject(result,path);return true;}
  const state=useStudioStore.getState();
  const expectedSessionToken=state.projectDocument?.projectId===result.snapshot.project.projectId?state.projectSessionToken:null;
  useStudioStore.setState({projectTransitionPending:true});
  try{
    const active=await invoke<ProjectOpenResult>("activate_project_session",{snapshot:result.snapshot,assetPaths:result.assetPaths,expectedSessionToken});
    if(!active.sessionToken)throw new Error("Native project activation returned no session token");
    if(!sameOrigin(expected)||useStudioStore.getState().projectGeneration!==generation)return false;
    hydrateProject(active,path);
    return true;
  }finally{useStudioStore.setState({projectTransitionPending:false});}
}

export function syncPreparedProject(result:ProjectOpenResult,expected:ReturnType<typeof origin>,generation:number):boolean {
  const state=useStudioStore.getState();
  if(!sameOrigin(expected)||state.projectGeneration!==generation||result.snapshot.generation<generation||state.projectDocument?.projectId!==result.snapshot.project.projectId)return false;
  hydrating=true;
  try{useStudioStore.setState({projectDocument:structuredClone(result.snapshot.project),projectGeneration:result.snapshot.generation,projectAssetPaths:result.assetPaths,projectSessionToken:result.sessionToken??state.projectSessionToken});}
  finally{hydrating=false;}
  return true;
}

export interface BannerAssetArchivePreview { manifest:BannerAssetManifest; manifestSha256:string }
export interface BannerAssetImportContext { projectId:string; announcerId:string; generation:number }

export function captureBannerAssetImportContext():BannerAssetImportContext {
  const current=document(),state=useStudioStore.getState();
  return {projectId:current.projectId,announcerId:current.announcerId,generation:state.projectGeneration};
}

export async function inspectBannerAssetArchive(path:string):Promise<BannerAssetArchivePreview> {
  const preview=await invoke<BannerAssetArchivePreview>("inspect_banner_asset_archive",{path});
  const issues=validateBannerAssetManifest(preview.manifest);
  if(issues.length)throw new Error(`Banner asset contract rejected: ${issues.join("; ")}`);
  if(!/^[0-9a-f]{64}$/.test(preview.manifestSha256))throw new Error("Banner archive preview has no verified manifest digest");
  return preview;
}

export async function applyBannerAssetArchive(path:string,manifestSha256:string,variantId:string,context:BannerAssetImportContext):Promise<boolean> {
  const before=useStudioStore.getState(),current=before.projectDocument;
  if(!current||current.projectId!==context.projectId||current.announcerId!==context.announcerId||before.projectGeneration!==context.generation)return false;
  const expectedOrigin=origin();
  const captured=await snapshotProject();
  const afterCapture=useStudioStore.getState();
  if(!sameOrigin(expectedOrigin)||captured.snapshot.generation!==context.generation||afterCapture.projectGeneration!==context.generation)return false;
  if(!captured.snapshot.project.variants.some(variant=>variant.id===variantId))throw new Error("Select a clip with a mapped voice variant first");
  const result=await invoke<ProjectOpenResult>("import_banner_asset_archive",{
    path,manifestSha256,variantId,expectedGeneration:context.generation,
    sessionToken:captured.sessionToken,snapshot:captured.snapshot,assetPaths:captured.assetPaths,
  });
  const latest=useStudioStore.getState();
  if(!sameOrigin(expectedOrigin)||latest.projectGeneration!==context.generation)return false;
  hydrateProject(result,latest.projectPath??"",variantId);
  return true;
}

export function hydrateProject(result:ProjectOpenResult,path?:string,selectedVariantId:string|null=null):void {
  validateProjectSnapshot(result.snapshot);
  const editor=resolveProjectEditor(result.snapshot.project,result.assetPaths);
  for(const asset of editor.bannerProject.assets)asset.source=convertFileSrc(asset.source);
  documentSession+=1;clearTimeout(recoveryTimer);
  hydrating=true;
  try{useStudioStore.setState({...editor,projectDocument:structuredClone(result.snapshot.project),projectSession:documentSession,projectGeneration:result.snapshot.generation,projectAssetPaths:result.assetPaths,projectSessionToken:result.sessionToken??null,projectTransitionPending:false,projectPath:path??useStudioStore.getState().projectPath,recentProjectId:result.snapshot.project.projectId,projectRecoveryError:null,pastClips:[],futureClips:[],pastBannerProjects:[],futureBannerProjects:[],selectedClipId:selectedVariantId,selectedBannerLayerIds:[]});}
  finally{hydrating=false;}
}

export function updateProjectMetadata(patch:Partial<Pick<PackProject,"name"|"author"|"locale">>):void {
  useStudioStore.setState({projectDocument:{...document(),...patch}});
}

export function updateProjectBinding(profileId:string,token:string):void {
  if(!profileId||!token||token.length>4096)throw new Error("Invalid project installation binding");
  const current=document();hydrating=true;
  try{useStudioStore.setState({projectDocument:{...current,installBindings:{...current.installBindings,[profileId]:token}}});}finally{hydrating=false;}
}

export function acceptProjectBuild(report:ProjectBuild&{generation:number;originProjectId:string;originAnnouncerId:string;superseded?:boolean},materialized?:ProjectOpenResult["snapshot"],assetPaths?:Record<string,string>):boolean {
  const state=useStudioStore.getState(),current=state.projectDocument;
  if(!current||current.projectId!==report.originProjectId||current.announcerId!==report.originAnnouncerId||(materialized&&(materialized.project.projectId!==report.originProjectId||materialized.project.announcerId!==report.originAnnouncerId))){report.superseded=true;return false;}
  const entry:ProjectBuild={revision:report.revision,digest:report.digest,artifactId:report.artifactId,projectFingerprint:report.projectFingerprint,toolchainFingerprint:report.toolchainFingerprint};
  const history=current.buildHistory.some(build=>build.digest===report.digest)?current.buildHistory:[...current.buildHistory,entry];
  hydrating=true;
  try{
    const applies=!report.superseded&&report.generation===state.projectGeneration;
    if(!applies)report.superseded=true;
    const editor=applies&&materialized&&assetPaths?resolveProjectEditor(materialized.project,assetPaths):null;
    if(editor)for(const asset of editor.bannerProject.assets)asset.source=convertFileSrc(asset.source);
    useStudioStore.setState({...editor,...(editor?{selectedClipId:state.selectedClipId,projectAssetPaths:assetPaths}:{}),projectDocument:{...current,...(applies&&materialized?{assets:materialized.project.assets}:{}),buildHistory:history,currentRevision:applies?report.revision:current.currentRevision}});
    return applies;
  }finally{hydrating=false;}
}

export async function addProjectAsset(path:string,mediaType="audio/wav"):Promise<Asset>{
  if(!path||/^[a-z]+:\/\//i.test(path))throw new Error("Select a local media or font file");
  const state=useStudioStore.getState(),current=document();
  const prior=Object.entries(state.projectAssetPaths).find(([,value])=>value===path)?.[0];
  const existing=current.assets.find(asset=>asset.id===prior);if(existing)return existing;
  const assetId=`asset_${crypto.randomUUID()}`,originalName=path.replace(/\\/g,"/").split("/").pop()||"asset";
  const extension=/\.([a-z0-9]{1,8})$/i.exec(originalName)?.[1]?.toLowerCase()||"bin";
  const asset:Asset={id:assetId,relativePath:`assets/${assetId}.${extension}`,sha256:"",mediaType,sourceMetadata:{originalName}};
  useStudioStore.setState({projectDocument:{...current,assets:[...current.assets,asset]},projectAssetPaths:{...state.projectAssetPaths,[assetId]:path}});return asset;
}

export function updateVariant(variantId:string,patch:Partial<Variant>):void {
  const state=useStudioStore.getState(),captured=captureProject(document(),state,state.projectAssetPaths);
  const variant=captured.project.variants.find(value=>value.id===variantId);if(!variant)throw new Error(`Unknown variant ${variantId}`);
  Object.assign(variant,patch);
  useStudioStore.setState({projectDocument:captured.project,projectAssetPaths:captured.assetPaths,...(patch.bannerProject&&state.bannerVariantId===variantId?{bannerProject:structuredClone(patch.bannerProject)}:{})});
}

export function selectProjectVariant(clipId:string):void {
  const state=useStudioStore.getState(),captured=captureProject(document(),state,state.projectAssetPaths);
  const variant=captured.project.variants.find(value=>value.id===clipId);if(!variant)throw new Error(`Unknown variant ${clipId}`);
  const banner=structuredClone(variant.bannerProject);
  for(const asset of banner.assets){const path=asset.source.startsWith("asset:")?captured.assetPaths[asset.source.slice(6)]:asset.source;if(!path)throw new Error(`Missing asset ${asset.id}`);asset.source=convertFileSrc(path);}
  useStudioStore.setState({projectDocument:captured.project,projectAssetPaths:captured.assetPaths,selectedClipId:clipId,bannerVariantId:clipId,bannerProject:banner,pastBannerProjects:[],futureBannerProjects:[]});
}

export function newProject():void {hydrateProject({snapshot:{project:createPackProject(),generation:0,fingerprint:""},assetPaths:{}},"");}
export async function duplicateProject():Promise<void>{document();const expected=origin(),captured=await snapshotProject();if(!sameOrigin(expected))return;hydrateProject({snapshot:{...captured.snapshot,project:duplicatePackProject(captured.snapshot.project),generation:0,fingerprint:""},assetPaths:captured.assetPaths},"");}

export async function saveProject(saveAs=false):Promise<string>{
  try{
    document();const expected=origin();
    const state=useStudioStore.getState();
    const path=(!saveAs&&state.projectPath)||await save({title:saveAs?"บันทึกสำเนาโปรเจกต์ (lineage เดิม)":"บันทึกโปรเจกต์",defaultPath:state.projectPath||"project.ann",filters:[{name:"G-Ann Project",extensions:["ann"]}]});
    if(!path)return "ยกเลิกแล้ว";
    if(!sameOrigin(expected))return changedProject;
    const captured=await snapshotProject();
    if(!sameOrigin(expected))return changedProject;
    let confirmedDestinationDigest:string|null=null;
    let result:ProjectSaveResult|undefined;
    for(let attempt=0;attempt<3&&!result;attempt++){
      try{
        result=await invoke<ProjectSaveResult>("save_project",{path,...captured,sessionToken:captured.sessionToken,confirmedDestinationDigest});
      }catch(error){
        const conflict=/DESTINATION_CONFLICT:([0-9a-f]{64})/i.exec(String(error));
        if(!conflict)throw error;
        if(!saveAs)return "บันทึกไม่สำเร็จ: ไฟล์ปลายทางเป็นโปรเจกต์อื่นหรืออ่านไม่ได้ กรุณาใช้บันทึกสำเนาและยืนยันการแทนที่";
        if(attempt===2)throw new Error("ไฟล์ปลายทางเปลี่ยนระหว่างการยืนยัน กรุณาลองใหม่");
        if(!sameOrigin(expected))return changedProject;
        const replace=await confirm("ไฟล์นี้เป็นโปรเจกต์อื่นหรืออ่านไม่ได้ หากแทนที่ เนื้อหาเดิมจะถูกเขียนทับ ต้องการดำเนินการต่อหรือไม่?",{title:"แทนที่ไฟล์โปรเจกต์?",kind:"warning"});
        if(!replace)return "ยกเลิกแล้ว";
        if(!sameOrigin(expected))return changedProject;
        confirmedDestinationDigest=conflict[1].toLowerCase();
      }
    }
    if(!result)throw new Error("ไม่สามารถบันทึกปลายทางที่เปลี่ยนแปลงได้");
    if(!sameOrigin(expected))return changedProject;
    validateProjectSnapshot(result.snapshot);
    if(result.snapshot.project.projectId!==expected.projectId||result.snapshot.project.announcerId!==expected.announcerId)throw new Error("Saved project identity mismatch");
    if(useStudioStore.getState().projectGeneration===captured.snapshot.generation)hydrateProject(result,path);
    else useStudioStore.setState({projectPath:path});
    return `บันทึกแล้ว ✅\n${path}`;
  }catch(error){return `บันทึกไม่สำเร็จ: ${error}`;}
}

export async function openProject():Promise<string>{
  try{
    const expected=origin(),generation=useStudioStore.getState().projectGeneration;
    const unchanged=()=>sameOrigin(expected)&&useStudioStore.getState().projectGeneration===generation;
    const path=await open({filters:[{name:"G-Ann Project",extensions:["ann"]}]});if(!path||typeof path!=="string")return "ยกเลิกแล้ว";
    if(!unchanged())return changedProject;
    const result=await invoke<ProjectOpenResult>("open_project",{path});if(!unchanged())return changedProject;
    if(!await activateInspectedProject(result,path,expected,generation))return changedProject;
    return `เปิดโปรเจกต์แล้ว ✅ ${result.snapshot.project.variants.length} variants`;
  }catch(error){return `เปิดไม่สำเร็จ: ${error}`;}
}

export async function initializeProject():Promise<string|null>{
  try{
    const expected=origin(),generation=useStudioStore.getState().projectGeneration;
    const unchanged=()=>sameOrigin(expected)&&useStudioStore.getState().projectGeneration===generation;
    const path=await invoke<string|null>("project_startup_path");
    if(!unchanged())return changedProject;
    if(path){const result=await invoke<ProjectOpenResult>("open_project",{path});if(!unchanged())return changedProject;if(!await activateInspectedProject(result,path,expected,generation))return changedProject;return `เปิดโปรเจกต์แล้ว ✅ ${path}`;}
    const projectId=useStudioStore.getState().recentProjectId;
    if(projectId&&typeof window!=="undefined"){
      const listing=await invoke<RecoveryListing>("recover_project",{projectId});
      if(!unchanged())return changedProject;
      if(listing.candidates.length){
        const candidateId=await selectRecoveryCandidate(listing);if(!unchanged())return changedProject;if(!candidateId)return null;
        const result=await invoke<ProjectOpenResult>("open_recovery_candidate",{projectId,candidateId});if(!unchanged())return changedProject;
        if(!await activateInspectedProject(result,"",expected,generation))return changedProject;
        return "เปิดสำเนากู้คืนแล้ว — บันทึก .ann เพื่อเก็บงาน";
      }
    }
    return null;
  }catch(error){return `เปิดโปรเจกต์ไม่สำเร็จ: ${error}`;}
}

export async function recoverProject():Promise<string>{
  try{
    const expected=origin(),state=useStudioStore.getState(),generation=state.projectGeneration;
    const unchanged=()=>sameOrigin(expected)&&useStudioStore.getState().projectGeneration===generation;
    const projectId=state.projectDocument?.projectId||state.recentProjectId;if(!projectId)return "ไม่พบสำเนากู้คืน";
    const listing=await invoke<RecoveryListing>("recover_project",{projectId});if(!unchanged())return changedProject;
    const candidateId=await selectRecoveryCandidate(listing);if(!unchanged())return changedProject;
    if(!candidateId)return listing.warnings.length?`ไม่พบสำเนากู้คืนที่ใช้ได้: ${listing.warnings[0].message}`:"ยกเลิกการกู้คืนแล้ว";
    const result=await invoke<ProjectOpenResult>("open_recovery_candidate",{projectId,candidateId});if(!unchanged())return changedProject;
    if(!await activateInspectedProject(result,"",expected,generation))return changedProject;
    return "เปิดสำเนากู้คืนแล้ว — บันทึกเป็น .ann เพื่อเก็บงาน";
  }catch(error){return `กู้คืนไม่สำเร็จ: ${error}`;}
}

export async function importLegacyProject():Promise<string>{
  try{
    const expected=origin(),generation=useStudioStore.getState().projectGeneration;
    const unchanged=()=>sameOrigin(expected)&&useStudioStore.getState().projectGeneration===generation;
    const path=await open({title:"นำเข้าโปรเจกต์เก่า — ต้นฉบับไม่ถูกแก้",filters:[{name:"G-Ann Project",extensions:["ann"]}]});if(!path||typeof path!=="string")return "ยกเลิกแล้ว";
    if(!unchanged())return changedProject;
    const legacy=JSON.parse(await invoke<string>("read_text_file",{path}));
    if(!unchanged())return changedProject;
    if(legacy.version!==1||!Array.isArray(legacy.clips))throw new Error("Expected .ann v1 project");
    const media=await open({title:"เลือกสื่อต้นฉบับเพื่อเชื่อมใหม่",filters:[{name:"Media",extensions:["wav","mp3","flac","ogg","webm","mp4"]}]});if(!media||typeof media!=="string")return "ยกเลิกแล้ว";
    if(!unchanged())return changedProject;
    const extracted=await invoke<{path:string;duration:number}>("extract_audio",{inputPath:media});
    if(!unchanged())return changedProject;
    const state=useStudioStore.getState(),captured=captureProject(createPackProject(),{...state,sourcePath:media,wavPath:extracted.path,duration:extracted.duration,clips:legacy.clips,packBuilder:{},trackItems:[]},{});
    const result={snapshot:{project:captured.project,generation:0,fingerprint:""},assetPaths:captured.assetPaths};
    if(!await activateInspectedProject(result,"",expected,generation))return changedProject;
    return "นำเข้าโปรเจกต์เก่าแล้ว — บันทึกเป็น .ann v2 ใหม่";
  }catch(error){return `นำเข้าไม่สำเร็จ: ${error}`;}
}
