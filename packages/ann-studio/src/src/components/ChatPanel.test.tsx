// @vitest-environment jsdom
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {handleCommand} from "./ChatPanel";
import {chatLlm} from "../lib/llm";
import {useStudioStore} from "../store/useStudioStore";

const api = vi.hoisted(() => ({invoke:vi.fn(), save:vi.fn(), export:vi.fn()}));
vi.mock("@tauri-apps/api/core", () => ({invoke:api.invoke}));
vi.mock("../lib/project", () => ({saveProject:api.save}));
vi.mock("../lib/actions", async importActual => ({
  ...await importActual<typeof import("../lib/actions")>(), runExport:api.export
}));

beforeEach(() => {
  vi.clearAllMocks();
  useStudioStore.setState({clips:[{id:"a",name:"A",event:"kill",start:0,end:1,color:""}],
    selectedClipId:null,wavPath:null});
});
afterEach(() => vi.restoreAllMocks());

it.each(["ไม่ต้องล้าง", "don't clear", "please explain clear all", "อย่าลบ clip 1", "do not delete clip 1"])(
  "preserves clips for %s even when a confirmation would be accepted", async text => {
    const confirm = vi.spyOn(window,"confirm").mockReturnValue(true);
    const before = useStudioStore.getState().clips;
    await handleCommand(text);
    expect(useStudioStore.getState().clips).toBe(before);
    expect(confirm).not.toHaveBeenCalled();
  });

it("clears only after confirming the clip count",async () => {
  const confirm = vi.spyOn(window,"confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  await handleCommand("clear all");
  expect(useStudioStore.getState().clips).toHaveLength(1);
  await handleCommand("ล้างทั้งหมด");
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("1 คลิป"));
  expect(useStudioStore.getState().clips).toHaveLength(0);
});

it("keeps project save distinct from package export online and offline",async () => {
  await handleCommand("save"); await chatLlm("บันทึก"); await handleCommand("ส่งออก");
  expect(api.save).toHaveBeenCalledTimes(2); expect(api.export).toHaveBeenCalledTimes(1);
  expect(api.invoke).not.toHaveBeenCalled();
});
