import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import "./tokens.css";
import "./components.css";

export type GlassVariant = "primary" | "secondary" | "quiet" | "danger";
export type GlassMaterial = "glass" | "solid";

type PanelProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  children: ReactNode;
  title?: ReactNode;
  action?: ReactNode;
  material?: GlassMaterial;
  emphasis?: "selected" | "normal";
  as?: "section" | "aside" | "div";
};

export function GlassPanel({
  children, title, action, material = "glass", emphasis = "normal",
  as: Element = "section", className = "", ...rest
}: PanelProps) {
  return <Element {...rest} className={`ann-glass-surface ${className}`} data-material={material} data-emphasis={emphasis}>
    {title && <div className="ann-glass-surface__heading">
      <div className="ann-glass-surface__title">{title}</div>{action}
    </div>}
    {children}
  </Element>;
}

type GlassButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: GlassVariant;
  icon?: ReactNode;
  compact?: boolean;
  children: ReactNode;
};

export function GlassButton({
  variant = "secondary", icon, compact = false, children,
  className = "", title, ...rest
}: GlassButtonProps) {
  // Compact icon buttons must carry a name for keyboard and assistive tech.
  const label = typeof children === "string" ? children : undefined;
  return <button
    {...rest}
    type={rest.type ?? "button"}
    data-variant={variant} data-compact={compact}
    aria-label={compact ? (rest["aria-label"] ?? label) : rest["aria-label"]}
    title={title ?? (compact ? label : undefined)}
    className={`ann-glass-btn ${className}`}
  >
    {icon && <span className="ann-glass-btn__icon" aria-hidden="true">{icon}</span>}
    {!compact && <span className="ann-glass-btn__label">{children}</span>}
    {compact && <span className="ann-glass-visually-hidden">{children}</span>}
  </button>;
}

export function GlassPill({
  children, tone = "neutral", className = "",
}: {children: ReactNode; tone?: "neutral" | "success" | "danger"; className?: string}) {
  return <span className={`ann-glass-pill ${className}`} data-tone={tone}>
    <span className="ann-glass-pill__label">{children}</span>
  </span>;
}
