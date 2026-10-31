// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createBannerLayer, createDefaultBannerProject } from './bannerProject';
import { renderBannerProject, sampleLayer, validateBannerTimeline } from './renderBannerProject';

describe('authored banner timeline',()=>{
 it('samples each variant caption and interpolates declarative transforms',()=>{
  const layer=createBannerLayer('text',0,{content:{text:'เสียงที่สอง'},timing:{startMs:100,endMs:900},motion:{keyframes:[{timeMs:100,transform:{x:10,y:50,width:40,height:12,rotation:0,opacity:1},easing:'linear'},{timeMs:900,transform:{x:90,y:50,width:40,height:12,rotation:0,opacity:1},easing:'linear'}]}});
  expect(sampleLayer(layer,0)).toBeNull();
  expect(sampleLayer(layer,500)?.transform.x).toBe(50);
  expect(sampleLayer(layer,500)?.content.text).toBe('เสียงที่สอง');
  expect(sampleLayer(layer,901)).toBeNull();
 });
 it('rejects unordered keyframes and scripts rather than executing imported sources',()=>{
  const project=createDefaultBannerProject();
  project.layers[0].motion={keyframes:[{timeMs:20,transform:project.layers[0].transform,easing:'linear'},{timeMs:10,transform:project.layers[0].transform,easing:'linear'}]};
  expect(()=>validateBannerTimeline(project,1000)).toThrow('keyframes');
  project.layers[0].motion=undefined;
  project.assets=[{id:'untrusted',name:'script',kind:'svg',mime:'image/svg+xml',source:'data:image/svg+xml,<svg onload="bad()"/>'}];
  expect(()=>validateBannerTimeline(project,1000)).toThrow('SVG');
 });
 it('draws the selected variant text and timed positions into actual frame canvases',async()=>{
  const labels:string[]=[],positions:number[]=[];
  const context={clearRect:vi.fn(),save:vi.fn(),restore:vi.fn(),translate:(x:number)=>positions.push(x),rotate:vi.fn(),fillText:(text:string)=>labels.push(text),fillRect:vi.fn(),strokeRect:vi.fn(),globalAlpha:1};
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockImplementation(()=>`data:image/png;base64,${labels[labels.length-1]}`);
  const project=createDefaultBannerProject();project.layers=[createBannerLayer('text',0,{content:{text:'ตัวแปรสอง'},motion:{keyframes:[{timeMs:0,transform:{x:10,y:50,width:40,height:12,rotation:0,opacity:1},easing:'linear'},{timeMs:1000,transform:{x:90,y:50,width:40,height:12,rotation:0,opacity:1},easing:'linear'}]}})];
  const rendered=await renderBannerProject(project,1000,{},2);
  expect(rendered.frames).toEqual(['ตัวแปรสอง','ตัวแปรสอง']);expect(positions).toEqual([128,640]);
  vi.restoreAllMocks();
 });
});
