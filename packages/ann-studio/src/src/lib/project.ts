import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { useStudioStore } from "../store/useStudioStore";

/** Save the current project state to a `.ann` file (JSON). Returns a status message. */
export async function saveProject(): Promise<string> {
  try {
    const path = await save({
      title: "บันทึกโปรเจกต์",
      defaultPath: "project.ann",
      filters: [{ name: "G-Ann Project", extensions: ["ann"] }],
    });
    if (!path) return "ยกเลิกแล้ว";
    const { sourcePath, wavPath, duration, clips } = useStudioStore.getState();
    const obj = { version: 1, sourcePath, wavPath, duration, clips };
    await invoke("save_text_file", { path, content: JSON.stringify(obj, null, 2) });
    return `บันทึกแล้ว ✅\n${path}`;
  } catch (e) {
    return `บันทึกไม่สำเร็จ: ${e}`;
  }
}

/** Open a `.ann` project file and load it into the store. Returns a status message. */
export async function openProject(): Promise<string> {
  try {
    const path = await open({
      filters: [{ name: "G-Ann Project", extensions: ["ann"] }],
    });
    if (!path) return "ยกเลิกแล้ว";
    const raw = await invoke<string>("read_text_file", { path });
    const p = JSON.parse(raw);
    useStudioStore.setState({
      sourcePath: p.sourcePath ?? null,
      wavPath: p.wavPath ?? null,
      duration: p.duration ?? 0,
      clips: p.clips ?? [],
      pastClips: [],
      futureClips: [],
      selectedClipId: null,
    });
    return `เปิดโปรเจกต์แล้ว ✅ ${(p.clips ?? []).length} clips`;
  } catch (e) {
    return `เปิดไม่สำเร็จ: ${e}`;
  }
}
