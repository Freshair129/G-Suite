import { useRef, useCallback, useId } from "react";

interface KnobProps {
  value: number;
  min: number;
  max: number;
  label: string;
  size?: "sm" | "md" | "lg";
  color?: string;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}

const SIZES = { sm: 48, md: 64, lg: 96 };

export default function Knob({
  value, min, max, label, size = "md",
  color = "#e0ff00", onChange, format,
}: KnobProps) {
  const knobRef = useRef<HTMLDivElement>(null);
  const gradId = useId();
  const px = SIZES[size];

  const norm = (value - min) / (max - min);
  const START = 135;
  const SWEEP = 270;
  const angle = START + norm * SWEEP;
  const rad = (d: number) => (d * Math.PI) / 180;

  const cx = 50, cy = 50, r = 40, ir = 28;

  const sx = cx + r * Math.cos(rad(START));
  const sy = cy + r * Math.sin(rad(START));
  const ex = cx + r * Math.cos(rad(angle));
  const ey = cy + r * Math.sin(rad(angle));
  const large = norm * SWEEP > 180 ? 1 : 0;
  const arc = norm > 0.002 ? `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}` : "";

  const bgEx = cx + r * Math.cos(rad(START + SWEEP));
  const bgEy = cy + r * Math.sin(rad(START + SWEEP));
  const bgArc = `M ${sx} ${sy} A ${r} ${r} 0 1 1 ${bgEx} ${bgEy}`;

  const dotR = ir - 4;
  const dx = cx + dotR * Math.cos(rad(angle));
  const dy = cy + dotR * Math.sin(rad(angle));

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const sY = e.clientY;
    const sVal = value;
    const range = max - min;
    const sensitivity = size === "lg" ? 200 : 150;
    function onMove(ev: MouseEvent) {
      const delta = ((sY - ev.clientY) / sensitivity) * range;
      onChange(Math.max(min, Math.min(max, sVal + delta)));
    }
    function onUp() { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [value, min, max, onChange, size]);

  const display = format ? format(value) : value.toFixed(1);

  return (
    <div className="flex flex-col items-center gap-0.5 select-none">
      <div className="cursor-grab active:cursor-grabbing" onMouseDown={handleMouseDown} style={{ width: px, height: px }}>
        <svg viewBox="0 0 100 100" width={px} height={px}>
          <defs>
            <radialGradient id={gradId} cx="40%" cy="35%">
              <stop offset="0%" stopColor="#3a3a3e" />
              <stop offset="100%" stopColor="#1a1a1e" />
            </radialGradient>
          </defs>
          <path d={bgArc} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" strokeLinecap="round" />
          {arc && <path d={arc} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 4px ${color}60)` }} />}
          <circle cx={cx} cy={cy} r={ir + 2} fill="#111" />
          <circle cx={cx} cy={cy} r={ir} fill={`url(#${gradId})`} />
          <circle cx={cx} cy={cy} r={ir - 0.5} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
          <circle cx={dx} cy={dy} r="3" fill={color} />
        </svg>
      </div>
      <span className="text-[10px] text-ink-faint font-medium leading-tight">{label}</span>
      <span className="text-[9px] font-mono text-ink-muted leading-tight">{display}</span>
    </div>
  );
}
