#!/usr/bin/env python3
r"""W4 — button-OCR event labeler (G-Vision engine, v0).

Announcer-pack showcase videos (the HoN preview UI) show a FIXED grid of event
buttons in a panel; the user clicks each to play it while a green caption + audio
fire (detect_boundaries.py brackets those line windows). This reads WHICH button
was active per line window:

  1. OCR the button panel  -> label + screen position for each visible button
  2. find the golden Dota-style cursor arrow (warm blob: R>G>B)
  3. the active button = the OCR label nearest the cursor

It emits the RAW label text ("Hat Trick", "Double Tap", ...). The frontend
resolves HoN -> G-Maiden event ids via `honEventMap.ts` (matchAnnouncerLabel),
the single source of truth — this script never hardcodes that table, and it
tolerates OCR noise there (camelCase / mild misreads).

Sidecar contract (mirrors detect_boundaries.py / transcribe.py):

    python detect_buttons.py <video> --windows '[[startMs,endMs],...]'
        [--roi x0,y0,x1,y1 fractions] [--samples 3]
        [--cursor-min-area N] [--max-dist-frac F]

`PROGRESS <0-100>` on stderr; one JSON object on stdout:

    {"labels": [{"startMs": 5900, "endMs": 7600, "label": "Bloodlust",
                 "cursor": true, "conf": 0.85}, ...]}

v0 is CALIBRATED for the Na Khom / HoN preview panel (button grid bottom-right,
golden cursor). Community uploads vary (panel position, cursor style), so the ROI
and cursor thresholds are parameters; a later step should learn them per video.
"""
from __future__ import annotations

import argparse
import json
import sys

import av
import cv2
import numpy as np


def _gold_cursor(bgr: np.ndarray, min_area: int) -> tuple[float, float] | None:
    """Centroid of the largest warm (golden) blob — the Dota-style cursor."""
    a = bgr.astype(np.int16)
    B, G, R = a[..., 0], a[..., 1], a[..., 2]
    mask = ((R > 120) & ((R - B) > 55) & ((R - G) > 25)).astype(np.uint8)
    n, _lab, stats, cent = cv2.connectedComponentsWithStats(mask, 8)
    if n <= 1:
        return None
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    if stats[i, cv2.CC_STAT_AREA] < min_area:
        return None
    return float(cent[i][0]), float(cent[i][1])


def _frame_at(container, vs, tb: float, t_sec: float) -> np.ndarray | None:
    """Nearest decoded frame at (or just after) `t_sec`, as a BGR ndarray."""
    try:
        container.seek(int(t_sec / tb), stream=vs, any_frame=False, backward=True)
    except av.AVError:
        return None
    for frame in container.decode(vs):
        ft = float(frame.pts * tb) if frame.pts is not None else 0.0
        if ft >= t_sec - 0.05:
            return frame.to_ndarray(format="bgr24")
    return None


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--windows", required=True,
                    help="JSON array of [startMs, endMs] line windows")
    ap.add_argument("--roi", default="0.36,0.80,0.82,1.0",
                    help="button-panel region as x0,y0,x1,y1 fractions of frame")
    ap.add_argument("--samples", type=int, default=3,
                    help="frames sampled per window (cursor is voted across them)")
    ap.add_argument("--cursor-min-area", type=int, default=30)
    ap.add_argument("--max-dist-frac", type=float, default=0.09,
                    help="max cursor->button distance (fraction of frame width)")
    args = ap.parse_args()

    windows = json.loads(args.windows)
    fx0, fy0, fx1, fy1 = (float(v) for v in args.roi.split(","))

    # rapidocr is heavy; import lazily so --help etc. work without it installed.
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        print(json.dumps({"error": "rapidocr-onnxruntime not installed in the "
                                    "sidecar venv (pip install rapidocr-onnxruntime)"}))
        return 1
    ocr = RapidOCR()

    c = av.open(args.video)
    vs = c.streams.video[0]
    tb = float(vs.time_base)
    W, H = vs.codec_context.width, vs.codec_context.height
    x0, y0, x1, y1 = int(fx0 * W), int(fy0 * H), int(fx1 * W), int(fy1 * H)
    max_dist = args.max_dist_frac * W

    out = []
    for wi, (s_ms, e_ms) in enumerate(windows):
        s, e = s_ms / 1000.0, e_ms / 1000.0
        mid = _frame_at(c, vs, tb, (s + e) / 2)
        # OCR the panel once per window (buttons don't move mid-line)
        buttons: list[tuple[float, float, str, float]] = []
        if mid is not None:
            res, _ = ocr(mid[y0:y1, x0:x1])
            for box, txt, conf in (res or []):
                cx = x0 + (box[0][0] + box[2][0]) / 2
                cy = y0 + (box[0][1] + box[2][1]) / 2
                try:
                    cf = float(conf)
                except (TypeError, ValueError):
                    cf = 0.0
                buttons.append((cx, cy, str(txt).strip(), cf))

        # vote the active button across N cursor samples
        votes: dict[str, list[float]] = {}
        n = max(1, args.samples)
        for k in range(n):
            frac = (k + 1) / (n + 1)
            fr = _frame_at(c, vs, tb, s + frac * (e - s))
            if fr is None or not buttons:
                continue
            cur = _gold_cursor(fr[y0:y1, x0:x1], args.cursor_min_area)
            if cur is None:
                continue
            cxu, cyu = x0 + cur[0], y0 + cur[1]
            near = min(buttons, key=lambda b: (b[0] - cxu) ** 2 + (b[1] - cyu) ** 2)
            if ((near[0] - cxu) ** 2 + (near[1] - cyu) ** 2) ** 0.5 > max_dist:
                continue
            votes.setdefault(near[2], []).append(near[3])

        label, conf, cursor = None, 0.0, False
        if votes:
            label = max(votes, key=lambda l: len(votes[l]))
            conf = round(sum(votes[label]) / len(votes[label]), 2)
            cursor = True

        out.append({"startMs": s_ms, "endMs": e_ms, "label": label,
                    "cursor": cursor, "conf": conf})
        print(f"PROGRESS {min(99, round(100 * (wi + 1) / max(1, len(windows))))}",
              file=sys.stderr, flush=True)

    c.close()
    print(json.dumps({"labels": out}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
