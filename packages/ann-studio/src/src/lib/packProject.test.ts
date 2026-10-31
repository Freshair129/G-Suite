import { describe, expect, it } from "vitest";
import { createPackProject, duplicatePackProject, captureProject, resolveProjectEditor } from "./packProject";
import { validateProjectSnapshot } from "./projectValidation";
import { createDefaultBannerProject } from "./bannerProject";
import { cloneDefaultOverlayLayout } from "./overlayLayout";

function editor() {
  return {
    sourcePath: "C:/ต้นฉบับ/เสียง.wav", wavPath: "C:/ต้นฉบับ/เสียง.wav", duration: 4,
    clips: [{ id:"clip-one",name:"สวัสดี",start:0,end:1,event:"kill",color:"#fff" }, { id:"clip-two",name:"เสียงสอง",start:1,end:3,event:"unknown-event",color:"#fff" }],
    bannerProject:createDefaultBannerProject(),bannerVariantId:"clip-one",bannerOverrides:{},packBuilder:{},trackItems:[],trackCount:3,masterVolume:1,
    overlayLayout:cloneDefaultOverlayLayout(),selectedClipId:"clip-one",libraryRoot:"C:/คลัง",
  };
}

describe("PackProject v2",()=>{
  it("captures complete editor state using managed asset references and stable variant IDs",()=>{
    const state=editor();
    state.bannerProject.layers[1].content.text="คำบรรยายไทย";
    const first=captureProject(createPackProject(),state,{});
    const second=captureProject(first.project,state,first.assetPaths);
    expect(second.project.announcerId).toBe(first.project.announcerId);
    expect(second.project.variants.map(v=>[v.originalSoundId,v.mixedSoundId,v.bannerId])).toEqual(first.project.variants.map(v=>[v.originalSoundId,v.mixedSoundId,v.bannerId]));
    expect(first.project.variants[0].bannerProject.layers[1].content.text).toBe("คำบรรยายไทย");
    expect(first.project.variants[1].id).toBe("clip-two");
    expect(first.project.inactiveStock).toContain("clip-two");
    expect(first.project.eventMappings.some(m=>m.eventKey==="unknown-event")).toBe(false);
    expect(JSON.stringify(first.project)).not.toContain("C:/");
    expect(first.project.assets).toHaveLength(1);
  });

  it("restores moved project asset paths without the original machine",()=>{
    const captured=captureProject(createPackProject(),editor(),{});
    const id=captured.project.assets[0].id;
    const restored=resolveProjectEditor(captured.project,{[id]:"D:/ใหม่/managed/voice.wav"});
    expect(restored.wavPath).toBe("D:/ใหม่/managed/voice.wav");
    expect(restored.sourcePath).toBe("D:/ใหม่/managed/voice.wav");
    expect(()=>resolveProjectEditor(captured.project,{})).toThrow(/asset/i);
  });

  it("duplicates as a new lineage while Save As leaves IDs and revision unchanged",()=>{
    const original=captureProject(createPackProject(),editor(),{}).project;
    original.currentRevision=3;
    original.buildHistory=[{revision:3,digest:"a".repeat(64),artifactId:"old",projectFingerprint:"b",toolchainFingerprint:"c"}];
    const copy=duplicatePackProject(original);
    expect(copy.projectId).not.toBe(original.projectId);
    expect(copy.announcerId).not.toBe(original.announcerId);
    expect(copy.variants[0].originalSoundId).not.toBe(original.variants[0].originalSoundId);
    expect(copy.currentRevision).toBe(0);
    expect(copy.buildHistory).toEqual([]);
    expect(structuredClone(original).announcerId).toBe(original.announcerId);
  });

  it("preserves per-variant layers captions SFX fonts and histories",()=>{
    const current=captureProject(createPackProject(),editor(),{});
    const second=current.project.variants[1];
    second.bannerProject.layers[1].content.text="คำที่สอง";
    second.sfxCues=[{assetId:current.project.assets[0].id,startMs:250,gainDb:-3,trimStartMs:0,trimEndMs:500,fadeInMs:10,fadeOutMs:50}];
    current.project.templates=[{id:"thai-font",version:"1",fontFamily:"Noto Sans Thai",assetIds:[current.project.assets[0].id]}];
    const next=captureProject(current.project,editor(),current.assetPaths);
    expect(next.project.variants[1].bannerProject.layers[1].content.text).toBe("คำที่สอง");
    expect(next.project.variants[1].sfxCues).toEqual(second.sfxCues);
    expect(next.project.templates).toEqual(current.project.templates);
  });

  it("rejects malformed imports before a document can be replaced",()=>{
    const captured=captureProject(createPackProject(),editor(),{});
    const snapshot={project:captured.project,generation:0,fingerprint:""};
    expect(()=>validateProjectSnapshot(snapshot)).not.toThrow();
    for(const patch of [{schemaVersion:1},{projectId:"../escape"},{assets:[{id:"a",relativePath:"../escape",sha256:"",mediaType:"audio/wav",sourceMetadata:{originalName:"a"}}]},{variants:[{id:"broken"}]}]){
      expect(()=>validateProjectSnapshot({...snapshot,project:{...captured.project,...patch}})).toThrow();
    }
  });

  it("validates nested banner transforms and clip timing before hydration",()=>{
    const captured=captureProject(createPackProject(),editor(),{});
    const invalid=structuredClone(captured.project);
    (invalid.editor.bannerProject.layers[0].transform as unknown as {x:string}).x="broken";
    expect(()=>validateProjectSnapshot({project:invalid,generation:0,fingerprint:""})).toThrow(/banner/i);
    const clip=structuredClone(captured.project);clip.editor.clips[0].end=Number.NaN;
    expect(()=>validateProjectSnapshot({project:clip,generation:0,fingerprint:""})).toThrow(/clip/i);
  });
});
