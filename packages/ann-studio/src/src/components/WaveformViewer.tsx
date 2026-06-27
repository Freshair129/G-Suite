import { useEffect, useRef, useCallback } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.js";
import { useStudioStore, genId } from "../store/useStudioStore";
import { convertFileSrc } from "@tauri-apps/api/core";

export default function WaveformViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const { wavPath, clips, selectedClipId, addClip, updateClip, selectClip } =
    useStudioStore();

  const syncingRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || !wavPath) return;

    if (wsRef.current) {
      wsRef.current.destroy();
    }

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#58afe7",
      progressColor: "#1a7cc0",
      cursorColor: "#e05a28",
      height: 180,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      plugins: [regions],
    });

    wsRef.current = ws;

    const assetUrl = convertFileSrc(wavPath);
    ws.load(assetUrl);

    regions.enableDragSelection({
      color: "rgba(40, 152, 224, 0.25)",
    });

    regions.on("region-created", (region: Region) => {
      if (syncingRef.current) return;
      const id = genId();
      (region as any).id = id;
      addClip({
        id,
        name: `clip-${id.slice(-4)}`,
        start: region.start,
        end: region.end,
        event: "custom",
        color: region.color || "#2898e0",
      });
    });

    regions.on("region-updated", (region: Region) => {
      if (syncingRef.current) return;
      updateClip((region as any).id, {
        start: region.start,
        end: region.end,
      });
    });

    regions.on("region-clicked", (region: Region, e: MouseEvent) => {
      e.stopPropagation();
      selectClip((region as any).id);
      region.play();
    });

    return () => {
      ws.destroy();
      wsRef.current = null;
      regionsRef.current = null;
    };
  }, [wavPath]);

  // Sync store clips to waveform regions
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions) return;

    syncingRef.current = true;

    const existing = regions.getRegions();
    const existingIds = new Set(existing.map((r: any) => r.id));
    const storeIds = new Set(clips.map((c) => c.id));

    // Remove regions not in store
    for (const r of existing) {
      if (!storeIds.has((r as any).id)) {
        r.remove();
      }
    }

    // Add/update regions from store
    for (const clip of clips) {
      const existing_r = existing.find((r: any) => r.id === clip.id);
      if (!existing_r) {
        const r = regions.addRegion({
          start: clip.start,
          end: clip.end,
          color:
            clip.id === selectedClipId
              ? "rgba(224, 90, 40, 0.35)"
              : "rgba(40, 152, 224, 0.25)",
          drag: true,
          resize: true,
        });
        (r as any).id = clip.id;
      }
    }

    syncingRef.current = false;
  }, [clips, selectedClipId]);

  const handlePlayPause = useCallback(() => {
    wsRef.current?.playPause();
  }, []);

  const handleZoomIn = useCallback(() => {
    if (!wsRef.current) return;
    const z = wsRef.current.options.minPxPerSec || 50;
    wsRef.current.zoom(Math.min(z + 30, 500));
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!wsRef.current) return;
    const z = wsRef.current.options.minPxPerSec || 50;
    wsRef.current.zoom(Math.max(z - 30, 10));
  }, []);

  if (!wavPath) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600">
        <p className="text-lg">นำเข้าไฟล์เสียงหรือคลิปเพื่อเริ่มต้น</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-1.5 bg-panel border-b border-gray-800">
        <button
          onClick={handlePlayPause}
          className="px-2 py-1 bg-ice-600 hover:bg-ice-500 text-white rounded text-xs"
        >
          Play/Pause
        </button>
        <button
          onClick={handleZoomIn}
          className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs"
        >
          Zoom +
        </button>
        <button
          onClick={handleZoomOut}
          className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs"
        >
          Zoom -
        </button>
        <span className="text-xs text-gray-500 ml-2">
          ลากเพื่อเลือก region · คลิก region เพื่อเล่น
        </span>
      </div>
      <div ref={containerRef} className="flex-1 px-4 py-2 overflow-x-auto" />
    </div>
  );
}
