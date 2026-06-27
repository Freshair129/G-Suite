import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Package, Layers, FileAudio, Settings2 } from "lucide-react";
import { GMAIDEN_EVENTS } from "../data/gmaiden-events";
import { useStudioStore, packId, type Pack } from "../store/useStudioStore";

const EVENT_LIST = GMAIDEN_EVENTS.filter((e) => e.id !== "unused");

type PackType = "full" | "single" | "custom";

export default function PackCreator({ onClose }: { onClose: () => void }) {
  const { setPacks, packs, setActivePack } = useStudioStore();
  const [name, setName] = useState("");
  const [packType, setPackType] = useState<PackType>("full");
  const [singleEvent, setSingleEvent] = useState(EVENT_LIST[0].id);
  const [customEvents, setCustomEvents] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const toggleCustom = (id: string) =>
    setCustomEvents((prev) => ({ ...prev, [id]: !prev[id] }));

  const selectAll = () => {
    const all: Record<string, boolean> = {};
    EVENT_LIST.forEach((e) => (all[e.id] = true));
    setCustomEvents(all);
  };

  const deselectAll = () => setCustomEvents({});

  function getEvents(): string[] {
    switch (packType) {
      case "full":
        return EVENT_LIST.map((e) => e.id);
      case "single":
        return [singleEvent];
      case "custom":
        return Object.entries(customEvents)
          .filter(([, v]) => v)
          .map(([k]) => k);
    }
  }

  async function handleCreate() {
    const events = getEvents();
    if (events.length === 0) {
      alert("เลือกอย่างน้อย 1 event");
      return;
    }
    if (!name.trim()) {
      alert("ใส่ชื่อ pack");
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const pack: Pack = {
        id: packId(),
        name: name.trim(),
        pack_type: packType,
        events,
        mappings: {},
        created_at: now,
        updated_at: now,
      };
      await invoke("save_pack", { manifest: pack });
      setPacks([pack, ...packs]);
      setActivePack(pack.id);
      onClose();
    } catch (e) {
      alert(`สร้าง pack ไม่สำเร็จ: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  const customCount = Object.values(customEvents).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-panel border border-line rounded-3xl w-[520px] max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <div className="flex items-center gap-2">
            <Package size={18} className="text-lime" />
            <h3 className="text-sm font-bold">สร้าง Pack ใหม่</h3>
          </div>
          <button
            onClick={onClose}
            className="grid place-items-center w-7 h-7 rounded-lg hover:bg-white/10 transition"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Name */}
          <div>
            <label className="text-xs text-ink-muted mb-1.5 block">
              ชื่อ Pack
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น Anime Pack, Thai Caster..."
              className="w-full px-3 py-2 rounded-xl bg-base border border-line text-sm outline-none focus:border-lime/50 transition"
            />
          </div>

          {/* Type selector */}
          <div>
            <label className="text-xs text-ink-muted mb-2 block">
              ประเภท Pack
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  {
                    type: "full" as PackType,
                    icon: Layers,
                    label: "Full Pack",
                    desc: `ทุก event (${EVENT_LIST.length})`,
                  },
                  {
                    type: "single" as PackType,
                    icon: FileAudio,
                    label: "Single",
                    desc: "เสียงแค่ 1 event",
                  },
                  {
                    type: "custom" as PackType,
                    icon: Settings2,
                    label: "Custom",
                    desc: "เลือกเอง",
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.type}
                  onClick={() => setPackType(opt.type)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs transition ${
                    packType === opt.type
                      ? "border-lime/50 bg-lime/5 text-lime"
                      : "border-line bg-base text-ink-faint hover:border-white/20"
                  }`}
                >
                  <opt.icon size={20} />
                  <span className="font-medium">{opt.label}</span>
                  <span className="text-[10px] text-ink-faint">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Single: dropdown */}
          {packType === "single" && (
            <div>
              <label className="text-xs text-ink-muted mb-1.5 block">
                เลือก Event
              </label>
              <select
                value={singleEvent}
                onChange={(e) => setSingleEvent(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-base border border-line text-sm outline-none cursor-pointer"
              >
                {EVENT_LIST.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.label} — {ev.trigger}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Custom: checklist */}
          {packType === "custom" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-ink-muted">
                  เลือก Events ({customCount})
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={selectAll}
                    className="text-[10px] text-lime hover:underline"
                  >
                    เลือกทั้งหมด
                  </button>
                  <button
                    onClick={deselectAll}
                    className="text-[10px] text-ink-faint hover:underline"
                  >
                    ล้าง
                  </button>
                </div>
              </div>
              <div className="max-h-[240px] overflow-y-auto rounded-xl border border-line bg-base divide-y divide-line/50">
                {EVENT_LIST.map((ev) => (
                  <label
                    key={ev.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-panel-hover/50 cursor-pointer transition"
                  >
                    <input
                      type="checkbox"
                      checked={!!customEvents[ev.id]}
                      onChange={() => toggleCustom(ev.id)}
                      className="accent-lime rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium">{ev.label}</span>
                      <span className="text-[10px] text-ink-faint ml-2">
                        {ev.category}
                      </span>
                    </div>
                    <span className="text-[10px] text-ink-faint truncate max-w-[140px]">
                      {ev.trigger}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-line">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full text-xs text-ink-faint hover:text-ink transition"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="px-5 py-2 rounded-full bg-gradient-to-r from-lime to-grass text-black text-xs font-semibold hover:opacity-90 transition disabled:opacity-50"
          >
            {saving ? "กำลังสร้าง…" : "สร้าง Pack"}
          </button>
        </div>
      </div>
    </div>
  );
}
