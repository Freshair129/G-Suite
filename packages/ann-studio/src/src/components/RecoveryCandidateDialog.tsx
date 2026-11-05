import type { RecoveryListing } from "../lib/project";
import { useEffect, useRef } from "react";

export default function RecoveryCandidateDialog({
  listing,
  onSelect,
  onCancel,
}: {
  listing: RecoveryListing;
  onSelect: (candidateId: string) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef(onCancel);
  useEffect(() => { cancelRef.current = onCancel; }, [onCancel]);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog) return;
    const dialogElement: HTMLElement = dialog;
    const focusable = () => Array.from(dialogElement.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getAttribute("aria-hidden") !== "true");
    const items = focusable();
    (items[0] ?? dialog).focus();
    function containFocus(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const current = focusable();
      if (!current.length) {
        event.preventDefault();
        dialogElement.focus();
      } else if (!dialogElement.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? current[current.length - 1] : current[0]).focus();
      } else if (event.shiftKey && document.activeElement === current[0]) {
        event.preventDefault();
        current[current.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === current[current.length - 1]) {
        event.preventDefault();
        current[0].focus();
      }
    }
    document.addEventListener("keydown", containFocus);
    return () => {
      document.removeEventListener("keydown", containFocus);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/70 p-4" role="presentation">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-title"
        className="flex max-h-[min(80vh,760px)] w-full max-w-2xl flex-col gap-4 overflow-hidden rounded-2xl border border-line bg-panel p-5 shadow-2xl"
      >
        <header>
          <h2 id="recovery-title" className="text-lg font-semibold">เลือกสำเนาโปรเจกต์ที่จะเปิด</h2>
          <p className="mt-1 text-sm text-ink-muted">ตรวจชื่อโปรเจกต์และ generation ก่อนเปิด รายการ recovery เก่ายังคงเก็บไว้</p>
        </header>
        <div className="min-h-0 space-y-2 overflow-auto" aria-label="สำเนา recovery">
          {listing.candidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => onSelect(candidate.id)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-base p-3 text-left hover:border-lime focus-visible:outline focus-visible:outline-2 focus-visible:outline-lime"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{candidate.name} · {candidate.kind === "active" ? "Recovery ล่าสุด" : "Recovery ที่เก็บไว้"} · generation {candidate.generation}</span>
                <span className="block truncate text-xs text-ink-muted">fingerprint {candidate.fingerprint.slice(0, 12)}</span>
              </span>
              <span className="shrink-0 rounded-full border border-line px-3 py-1 text-sm">เปิดรายการนี้</span>
            </button>
          ))}
          {!listing.candidates.length && <p className="text-sm text-ink-muted">ไม่มีสำเนาที่เปิดได้</p>}
        </div>
        {(listing.warnings.length > 0 || listing.truncated) && (
          <div className="max-h-32 overflow-auto rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-sm" role="status">
            <p className="font-medium">มีรายการที่อ่านไม่ได้หรือรายการไม่ครบ</p>
            {listing.truncated && <p>แสดงรายการตามขีดจำกัดการตรวจสอบ โปรดตรวจซ้ำภายหลัง</p>}
            {listing.warnings.map((warning, index) => <p key={`${warning.id ?? "scan"}-${index}`}>{warning.message}</p>)}
          </div>
        )}
        <footer className="flex justify-end">
          <button type="button" onClick={onCancel} className="rounded-lg border border-line px-4 py-2 hover:border-ink-muted">ยกเลิก</button>
        </footer>
      </section>
    </div>
  );
}
