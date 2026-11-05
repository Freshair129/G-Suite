import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn(),convertFileSrc:(path:string)=>`http://asset.localhost/${encodeURIComponent(path)}`}));
vi.mock("@tauri-apps/plugin-dialog",()=>({confirm:vi.fn(),open:vi.fn(),save:vi.fn()}));
import { invoke } from "@tauri-apps/api/core";
import { confirm,open,save } from "@tauri-apps/plugin-dialog";
import { useStudioStore } from "../store/useStudioStore";
import { newProject,snapshotProject,selectProjectVariant,saveProject,openProject,recoverProject,initializeProject,importLegacyProject,updateProjectBinding,acceptProjectBuild,inspectBannerAssetArchive,captureBannerAssetImportContext,applyBannerAssetArchive,registerRecoveryPicker } from "./project";

let unregisterRecoveryPicker:(()=>void)|undefined;
function setRecoveryPicker(picker:Parameters<typeof registerRecoveryPicker>[0]){unregisterRecoveryPicker?.();unregisterRecoveryPicker=registerRecoveryPicker(picker);}
beforeEach(()=>{unregisterRecoveryPicker?.();unregisterRecoveryPicker=undefined;vi.mocked(invoke).mockReset();vi.mocked(open).mockReset();vi.mocked(save).mockReset();vi.mocked(confirm).mockReset();newProject();useStudioStore.setState({sourcePath:"C:/เสียง.wav",wavPath:"C:/เสียง.wav",clips:[{id:"one",name:"หนึ่ง",start:0,end:1,event:"kill",color:"red"},{id:"two",name:"สอง",start:1,end:2,event:"kill",color:"blue"}]});});
afterEach(()=>{unregisterRecoveryPicker?.();unregisterRecoveryPicker=undefined;vi.unstubAllGlobals();});
describe("portable project UI integration",()=>{
  it("keeps IDs stable and preserves second variant canvas edits across selection",async()=>{
    const first=await snapshotProject();const second=await snapshotProject();
    expect(first.snapshot.project.variants.map(v=>v.originalSoundId)).toEqual(second.snapshot.project.variants.map(v=>v.originalSoundId));
    selectProjectVariant("two");const banner=structuredClone(useStudioStore.getState().bannerProject);banner.layers[1].content.text="เฉพาะเสียงสอง";useStudioStore.getState().setBannerProject(banner);
    selectProjectVariant("one");const result=await snapshotProject();
    expect(result.snapshot.project.variants[1].bannerProject.layers[1].content.text).toBe("เฉพาะเสียงสอง");
    expect(result.snapshot.project.variants[0].bannerProject.layers[1].content.text).not.toBe("เฉพาะเสียงสอง");
  });
  it("keeps the current document when opening corrupt data",async()=>{
    const before=useStudioStore.getState().clips;vi.mocked(open).mockResolvedValue("D:/broken.ann");vi.mocked(invoke).mockResolvedValue({snapshot:{project:{schemaVersion:1}},assetPaths:{}});
    expect(await openProject()).toContain("เปิดไม่สำเร็จ");expect(useStudioStore.getState().clips).toBe(before);
  });
  it("does not discard edits made while an archive is opening",async()=>{
    const archive=await snapshotProject();vi.mocked(open).mockResolvedValue("D:/older.ann");
    let finish!:(value:unknown)=>void;
    vi.mocked(invoke).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=openProject();while(!finish)await new Promise(resolve=>setTimeout(resolve,0));
    useStudioStore.getState().updateClip("two",{name:"edited while opening"});
    finish(archive);await pending;
    expect(useStudioStore.getState().clips[1].name).toBe("edited while opening");
  });
  it.each(["startup","recover"] as const)("does not discard edits while %s opens a project",async operation=>{
    const archive=await snapshotProject();let finish!:(value:unknown)=>void;
    setRecoveryPicker(async()=>"recovery-A");
    vi.mocked(invoke).mockImplementation(async command=>{
      if(command==="project_startup_path")return "D:/older.ann";
      if(command==="recover_project")return {candidates:[{id:"recovery-A",projectId:archive.snapshot.project.projectId,kind:"history",name:"Earlier",generation:4,fingerprint:"a".repeat(64)}],warnings:[],truncated:false};
      return new Promise(resolve=>{finish=resolve;});
    });
    const pending=operation==="startup"?initializeProject():recoverProject();
    while(!finish)await new Promise(resolve=>setTimeout(resolve,0));
    useStudioStore.getState().updateClip("two",{name:"edited during recovery"});
    finish(archive);await pending;
    expect(useStudioStore.getState().clips[1].name).toBe("edited during recovery");
  });
  it("does not discard overlay edits made while opening an archive",async()=>{
    const archive=await snapshotProject();vi.mocked(open).mockResolvedValue("D:/older.ann");
    let finish!:(value:unknown)=>void;
    vi.mocked(invoke).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=openProject();while(!finish)await new Promise(resolve=>setTimeout(resolve,0));
    const layout=structuredClone(useStudioStore.getState().overlayLayout);layout.alert.x=42;
    useStudioStore.getState().setOverlayLayout(layout);
    finish(archive);await pending;
    expect(useStudioStore.getState().overlayLayout.alert.x).toBe(42);
  });
  it("does not replace edits made while importing a legacy project",async()=>{
    vi.mocked(open).mockResolvedValueOnce("D:/older.ann").mockResolvedValueOnce("D:/voice.wav");
    let finish!:(value:unknown)=>void;
    vi.mocked(invoke).mockImplementation(async command=>{
      if(command==="read_text_file")return JSON.stringify({version:1,clips:[]});
      if(command==="extract_audio")return new Promise(resolve=>{finish=resolve;});
      throw new Error(`Unexpected command ${command}`);
    });
    const pending=importLegacyProject();while(!finish)await new Promise(resolve=>setTimeout(resolve,0));
    useStudioStore.getState().updateClip("two",{name:"edited during legacy import"});
    finish({path:"D:/extracted.wav",duration:1});await pending;
    expect(useStudioStore.getState().clips[1].name).toBe("edited during legacy import");
    expect(vi.mocked(invoke).mock.calls.some(([command])=>command==="prepare_project")).toBe(false);
  });
  it("saves the full snapshot through native archive IO and retains concurrent edits",async()=>{
    useStudioStore.setState({projectSessionToken:"b".repeat(64)});
    vi.mocked(save).mockResolvedValue("D:/saved.ann");
    vi.mocked(invoke).mockImplementation(async(command,args)=>{
      expect(command).toBe("save_project");const captured=args as Awaited<ReturnType<typeof snapshotProject>>&{path:string};
      expect(captured.sessionToken).toBe("b".repeat(64));
      expect(JSON.stringify(captured.snapshot.project)).not.toContain("C:/");
      useStudioStore.getState().updateClip("two",{name:"edited while saving"});
      return {...captured,path:"D:/saved.ann"};
    });
    expect(await saveProject()).toContain("บันทึกแล้ว");expect(useStudioStore.getState().clips[1].name).toBe("edited while saving");
  });
  it("requires a content-bound confirmation before replacing another project's archive",async()=>{
    const sessionToken="d".repeat(64),destinationDigest="e".repeat(64);
    useStudioStore.setState({projectSessionToken:sessionToken});vi.mocked(save).mockResolvedValue("D:/existing.ann");vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(invoke).mockRejectedValueOnce(`DESTINATION_CONFLICT:${destinationDigest}`).mockImplementationOnce(async(command,args)=>{
      expect(command).toBe("save_project");
      expect((args as {confirmedDestinationDigest:string}).confirmedDestinationDigest).toBe(destinationDigest);
      return {...args as object,path:"D:/existing.ann",sessionToken};
    });
    expect(await saveProject(true)).toContain("บันทึกแล้ว");expect(confirm).toHaveBeenCalledTimes(1);expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("validates inspected project data before activating a native session",async()=>{
    const before=useStudioStore.getState().clips,inspected=await snapshotProject();
    inspected.snapshot.project.editor.trackCount=-1;vi.stubGlobal("window",{__TAURI_INTERNALS__:{}});vi.mocked(open).mockResolvedValue("D:/invalid.ann");
    vi.mocked(invoke).mockResolvedValue(inspected);
    expect(await openProject()).toContain("Invalid project");
    expect(vi.mocked(invoke).mock.calls.map(([command])=>command)).toEqual(["open_project"]);expect(useStudioStore.getState().clips).toBe(before);
  });
  it("activates a new native project without invalidating its first save",async()=>{
    const sessionToken="c".repeat(64);
    vi.stubGlobal("window",{__TAURI_INTERNALS__:{}});
    vi.mocked(save).mockResolvedValue("D:/first-save.ann");
    vi.mocked(invoke).mockImplementation(async(command,args)=>{
      if(command==="activate_project_session"){
        const captured=args as Awaited<ReturnType<typeof snapshotProject>>;
        return {...captured,snapshot:{...captured.snapshot,generation:captured.snapshot.generation+1},sessionToken};
      }
      expect(command).toBe("save_project");
      const captured=args as Awaited<ReturnType<typeof snapshotProject>>&{path:string};
      expect(captured.sessionToken).toBe(sessionToken);
      return {...captured,path:captured.path,sessionToken};
    });
    expect(await saveProject()).toContain("บันทึกแล้ว");
    expect(vi.mocked(invoke).mock.calls.map(([command])=>command)).toEqual(["activate_project_session","save_project"]);
  });
  it("persists view preferences without media or project contents",()=>{
    useStudioStore.getState().setTimelineZoom(90);
    const value=JSON.parse(localStorage.getItem("gann-preferences")||"{}");
    expect(value.state.timelineZoom).toBe(90);expect(value.state.clips).toBeUndefined();expect(value.state.bannerProject).toBeUndefined();expect(value.state.sourcePath).toBeUndefined();
  });
  it("opens associated .ann startup paths through the validated archive reader",async()=>{
    const prepared=await snapshotProject();
    vi.mocked(invoke).mockImplementation(async(command)=>command==="project_startup_path"?"D:/เปิดโปรเจกต์.ann":prepared);
    expect(await initializeProject()).toContain("เปิดโปรเจกต์");
    expect(invoke).toHaveBeenCalledWith("open_project",{path:"D:/เปิดโปรเจกต์.ann"});
    expect(open).not.toHaveBeenCalled();
  });
  it("keeps build history and installation bindings outside the content dirty token",async()=>{
    const first=await snapshotProject();updateProjectBinding("profile","opaque-binding");
    acceptProjectBuild({revision:1,digest:"a".repeat(64),artifactId:"artifact",projectFingerprint:first.snapshot.fingerprint,toolchainFingerprint:"tool",generation:first.snapshot.generation,originProjectId:first.snapshot.project.projectId,originAnnouncerId:first.snapshot.project.announcerId});
    const second=await snapshotProject();
    expect(second.snapshot.generation).toBe(first.snapshot.generation);expect(second.snapshot.fingerprint).toBe(first.snapshot.fingerprint);
    expect(second.snapshot.project.installBindings.profile).toBe("opaque-binding");expect(second.snapshot.project.currentRevision).toBe(1);
  });
  it("validates the preview contract and imports only to the confirmed variant",async()=>{
    const manifest={format:"g-suite-banner-asset",schemaVersion:1,assetId:"source-banner",revision:2,name:"Static",mediaKind:"still-image",editableControls:{title:false,outerMotion:["outerOpacity"]},files:[{id:"still-file",path:"assets/still.png",role:"stillImage",mediaType:"image/png",sizeBytes:4,sha256:"a".repeat(64)}]};
    vi.mocked(invoke).mockImplementation(async(command,args)=>{
      if(command==="inspect_banner_asset_archive")return {manifest,manifestSha256:"b".repeat(64)};
      expect(command).toBe("import_banner_asset_archive");
      const input=args as {variantId:string;expectedGeneration:number;manifestSha256:string};
      expect(input.variantId).toBe("two");expect(input.manifestSha256).toBe("b".repeat(64));
      const captured=await snapshotProject();
      const result=structuredClone(captured);
      result.snapshot.project.variants[1].bannerSource={assetId:"source-banner",revision:2,manifestSha256:"b".repeat(64)};
      result.snapshot.project.editor.bannerVariantId="two";
      return result;
    });
    const inspected=await inspectBannerAssetArchive("D:/banner.zip");
    expect(inspected.manifest.assetId).toBe("source-banner");
    useStudioStore.setState({sourcePath:"C:/voice.wav",wavPath:"C:/voice.wav"});
    await snapshotProject();selectProjectVariant("two");
    const context=captureBannerAssetImportContext();
    expect(await applyBannerAssetArchive("D:/banner.zip","b".repeat(64),"two",context)).toBe(true);
    expect(useStudioStore.getState().selectedClipId).toBe("two");
    expect(useStudioStore.getState().projectDocument?.variants[1].bannerSource?.assetId).toBe("source-banner");
    expect(useStudioStore.getState().projectDocument?.eventMappings).toEqual([{eventKey:"kill",variantIds:["one","two"]}]);
  });

  it("does not hydrate an import after the project changes during the native apply",async()=>{
    useStudioStore.setState({sourcePath:"C:/voice.wav",wavPath:"C:/voice.wav"});
    await snapshotProject();selectProjectVariant("two");
    const context=captureBannerAssetImportContext();
    const captured=await snapshotProject();
    const result=structuredClone(captured);result.snapshot.project.variants[1].bannerSource={assetId:"source-banner",revision:2,manifestSha256:"c".repeat(64)};
    let finish!:(value:unknown)=>void;
    vi.mocked(invoke).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=applyBannerAssetArchive("D:/banner.zip","c".repeat(64),"two",context);
    while(!finish)await new Promise(resolve=>setTimeout(resolve,0));
    useStudioStore.getState().updateClip("two",{name:"edited while importing"});
    const current=useStudioStore.getState().projectDocument;
    finish(result);expect(await pending).toBe(false);
    expect(useStudioStore.getState().projectDocument).toBe(current);
    expect(useStudioStore.getState().clips[1].name).toBe("edited while importing");
  });
  it("never attaches project A's finished build to project B even when generations collide",async()=>{
    const origin=await snapshotProject();newProject();useStudioStore.setState({projectGeneration:origin.snapshot.generation});
    const before=useStudioStore.getState();
    const report={revision:9,digest:"a".repeat(64),artifactId:"artifact-A",projectFingerprint:origin.snapshot.fingerprint,toolchainFingerprint:"tool",generation:origin.snapshot.generation,originProjectId:origin.snapshot.project.projectId,originAnnouncerId:origin.snapshot.project.announcerId,superseded:false};
    expect(acceptProjectBuild(report,origin.snapshot,origin.assetPaths)).toBe(false);
    expect(report.superseded).toBe(true);expect(useStudioStore.getState().projectDocument).toBe(before.projectDocument);expect(useStudioStore.getState().wavPath).toBeNull();
  });
  it("retains both variant banners after raw waveform selection and a build snapshot",async()=>{
    await snapshotProject();selectProjectVariant("two");
    const banner=structuredClone(useStudioStore.getState().bannerProject);banner.layers[0].content.text="B-only";useStudioStore.getState().setBannerProject(banner);
    useStudioStore.getState().selectClip("one");
    const captured=await snapshotProject();
    expect(captured.snapshot.project.variants[0].bannerProject.layers[0].content.text).not.toBe("B-only");
    expect(captured.snapshot.project.variants[1].bannerProject.layers[0].content.text).toBe("B-only");
  });
  it("does not save a replacement document into the original project's pending dialog path",async()=>{
    await snapshotProject();let finishDialog!:(path:string)=>void;
    vi.mocked(save).mockImplementation(()=>new Promise(resolve=>{finishDialog=resolve;}));
    const pending=saveProject();newProject();const replacement=useStudioStore.getState().projectDocument;finishDialog("D:/project-A.ann");await pending;
    expect(invoke).not.toHaveBeenCalled();expect(useStudioStore.getState().projectDocument).toBe(replacement);expect(useStudioStore.getState().projectPath).toBe("");
  });
  it.each(["save","open","recover"] as const)("ignores %s completion after another project replaces its origin",async operation=>{
    const origin=await snapshotProject();let complete!:(value:unknown)=>void;
    vi.mocked(save).mockResolvedValue("D:/project-A.ann");vi.mocked(open).mockResolvedValue("D:/project-A.ann");
    vi.mocked(invoke).mockImplementation(async(command)=>command==="recover_project"?{candidates:[{id:"recovery-A",projectId:origin.snapshot.project.projectId,kind:"history",name:"Earlier",generation:4,fingerprint:"a".repeat(64)}],warnings:[],truncated:false}:new Promise(resolve=>{complete=resolve;}));
    const pending=operation==="save"?saveProject():operation==="open"?openProject():recoverProject();
    while(!complete)await new Promise(resolve=>setTimeout(resolve,0));
    newProject();const replacement=useStudioStore.getState().projectDocument;
    complete({...origin,path:"D:/project-A.ann"});await pending;
    expect(useStudioStore.getState().projectDocument).toBe(replacement);expect(useStudioStore.getState().projectPath).toBe("");
  });
  it("opens the recovery candidate explicitly selected by the user",async()=>{
    const first=await snapshotProject();
    const listing={candidates:[
      {id:"candidate-active",projectId:first.snapshot.project.projectId,kind:"active" as const,name:"Current recovery",generation:7,fingerprint:"a".repeat(64)},
      {id:"candidate-history",projectId:first.snapshot.project.projectId,kind:"history" as const,name:"Older recovery",generation:5,fingerprint:"b".repeat(64)},
    ],warnings:[{id:"bad-file",message:"One damaged entry"}],truncated:false};
    setRecoveryPicker(async value=>{expect(value.candidates).toHaveLength(2);return "candidate-history";});
    vi.mocked(invoke).mockImplementation(async(command,args)=>{
      if(command==="recover_project")return listing;
      expect(command).toBe("open_recovery_candidate");
      expect(args).toEqual({projectId:first.snapshot.project.projectId,candidateId:"candidate-history"});
      return first;
    });
    expect(await recoverProject()).toContain("เปิดสำเนากู้คืนแล้ว");
  });
});
