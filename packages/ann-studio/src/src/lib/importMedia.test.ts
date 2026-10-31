import { beforeEach, expect, it, vi } from 'vitest';
import { createPackProject } from './packProject';
import { useStudioStore } from '../store/useStudioStore';
import { importProjectMedia } from './importMedia';
const {invoke,snapshot}=vi.hoisted(()=>({invoke:vi.fn(),snapshot:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke}));
vi.mock('./project',()=>({snapshotProject:snapshot}));
const result={asset:{id:'asset_original',relativePath:'assets/original.mp3',sha256:'a'.repeat(64),mediaType:'audio/mpeg',sourceMetadata:{originalName:'เสียง.mp3'}},path:'C:/managed/original.mp3',wav_path:'C:/managed/original.voice.wav',info:{duration_ms:2000}};
beforeEach(()=>{const project=createPackProject();useStudioStore.setState({projectDocument:project,projectAssetPaths:{},sourcePath:null,wavPath:null,clips:[]});snapshot.mockResolvedValue({snapshot:{project}});invoke.mockReset();});
it('imports through managed workspace rather than writing beside source',async()=>{
  invoke.mockResolvedValue(result);
  await importProjectMedia('Z:/read-only/เสียง.mp3');
  expect(invoke).toHaveBeenCalledWith('import_media',{projectId:useStudioStore.getState().projectDocument?.projectId,pickedPath:'Z:/read-only/เสียง.mp3'});
  expect(useStudioStore.getState().wavPath).toBe(result.wav_path);
  expect(useStudioStore.getState().sourcePath).toBe(result.path);
  expect(useStudioStore.getState().clips[0].name).toBe('เสียง.mp3');
});
it('does not apply a delayed import to a different open project',async()=>{
  invoke.mockImplementation(async()=>{useStudioStore.setState({projectDocument:createPackProject()});return result;});
  await expect(importProjectMedia('Z:/source.mp3')).rejects.toThrow('โปรเจกต์เปลี่ยนแล้ว');
  expect(useStudioStore.getState().wavPath).toBeNull();
});
