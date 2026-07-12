// LED-style time readout — recessed black panels with green glowing digits.
// No outer bezel (frameless), compact. Shows BPM + playhead MIN : SEC : MSEC.

function Digit({ v, label }: { v: string; label: string }) {
  return (
    <div className="flex flex-col items-center leading-none">
      <span
        className="font-mono font-bold tracking-wide"
        style={{ fontSize: 13, color: "#3dff92", textShadow: "0 0 5px rgba(61,255,146,0.6), 0 0 1px rgba(61,255,146,0.9)" }}
      >
        {v}
      </span>
      <span className="tracking-[0.16em] text-[#4f6a5b] mt-0.5" style={{ fontSize: 5.5 }}>{label}</span>
    </div>
  );
}

const SEP = (
  <span className="text-[#1f4230] font-bold pb-2" style={{ fontSize: 11 }}>:</span>
);

const recess = { background: "#050805", boxShadow: "inset 0 1px 4px rgba(0,0,0,0.9)" } as const;

export default function LedDisplay({ seconds, bpm }: { seconds: number; bpm?: number }) {
  const s = Math.max(0, seconds);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const mm = pad(Math.floor(s / 60));
  const ss = pad(Math.floor(s % 60));
  const cs = pad(Math.floor((s % 1) * 100));

  return (
    <div className="flex items-center gap-1.5">
      {bpm != null && (
        <div className="flex items-center rounded px-1.5 py-0.5" style={recess}>
          <Digit v={bpm.toString().padStart(3, "0")} label="TEMPO/BPM" />
        </div>
      )}
      <div className="flex items-center gap-1 rounded px-2 py-0.5" style={recess}>
        <Digit v={mm} label="MIN" />
        {SEP}
        <Digit v={ss} label="SEC" />
        {SEP}
        <Digit v={cs} label="MSEC" />
      </div>
    </div>
  );
}
