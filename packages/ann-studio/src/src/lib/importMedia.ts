import { invoke } from '@tauri-apps/api/core';
import { useStudioStore, genId } from '../store/useStudioStore';
import { snapshotProject } from './project';
import type { Asset } from './packProject';

export async function importProjectMedia(path:string):Promise<void> {
  const {snapshot}=await snapshotProject();
  const result=await invoke<{asset:Asset;path:string;wav_path:string|null;info:{duration_ms:number}}>('import_media',{projectId:snapshot.project.projectId,pickedPath:path});
  if(!result.wav_path || !Number.isFinite(result.info.duration_ms)||result.info.duration_ms<=0)throw new Error('สื่อนี้ไม่มีเสียง ใช้ภาพหรือวิดีโอเงียบในตัวแก้แบนเนอร์');
  const current=useStudioStore.getState();
  if(current.projectDocument?.projectId!==snapshot.project.projectId)throw new Error('โปรเจกต์เปลี่ยนแล้ว กรุณานำเข้าสื่อในโปรเจกต์ที่ต้องการอีกครั้ง');
  useStudioStore.setState({projectDocument:{...current.projectDocument,assets:[...current.projectDocument.assets.filter(a=>a.id!==result.asset.id),result.asset]},projectAssetPaths:{...current.projectAssetPaths,[result.asset.id]:result.path}});
  current.setSource(result.path,result.wav_path,result.info.duration_ms/1000);
  current.setClips([{id:genId(),name:result.asset.sourceMetadata.originalName,start:0,end:result.info.duration_ms/1000,event:'unused',color:''}]);
}
