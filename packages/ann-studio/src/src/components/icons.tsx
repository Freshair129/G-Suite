// Minimal inline icon set (stroke-based, 1.6px) — no icon-font dependency.
interface IconProps {
  size?: number;
  className?: string;
}
const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
});

export const IconImport = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M12 3v12" />
    <path d="m8 11 4 4 4-4" />
    <path d="M5 21h14" />
  </svg>
);

export const IconExport = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M12 15V3" />
    <path d="m8 7 4-4 4 4" />
    <path d="M5 21h14" />
  </svg>
);

export const IconWand = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M15 4V2" />
    <path d="M15 16v-2" />
    <path d="M8 9h2" />
    <path d="M20 9h2" />
    <path d="M17.8 11.8 19 13" />
    <path d="M15 9h.01" />
    <path d="M17.8 6.2 19 5" />
    <path d="m3 21 9-9" />
    <path d="M12.2 6.2 11 5" />
  </svg>
);

export const IconPlay = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)} fill="currentColor" stroke="none">
    <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" />
  </svg>
);

export const IconPause = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)} fill="currentColor" stroke="none">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

export const IconZoomIn = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
    <path d="M11 8v6" />
    <path d="M8 11h6" />
  </svg>
);

export const IconZoomOut = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
    <path d="M8 11h6" />
  </svg>
);

export const IconTrash = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);

export const IconWave = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M2 12h2" />
    <path d="M6 8v8" />
    <path d="M10 4v16" />
    <path d="M14 7v10" />
    <path d="M18 9v6" />
    <path d="M22 12h0" />
  </svg>
);

export const IconScissors = ({ size = 16, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M20 4 8.12 15.88" />
    <path d="M14.47 14.48 20 20" />
    <path d="M8.12 8.12 12 12" />
  </svg>
);
