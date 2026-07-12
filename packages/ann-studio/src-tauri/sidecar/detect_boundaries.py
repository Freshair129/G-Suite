#!/usr/bin/env python3
r"""Vision-based line-boundary detector (G-Vision engine, v0).

Announcer-pack showcase videos (e.g. the HoN preview UI) flash the spoken line
as a bright on-screen overlay while each clip plays, one line at a time. Audio
silence-splitting mis-segments those (merges words across events, over-long
gaps). This finds boundaries from the VIDEO instead: it watches an overlay
region for the caption's appear -> disappear, which brackets each line far more
cleanly than silence.

Sidecar contract (mirrors transcribe.py): invoked by the Rust backend as

    python detect_boundaries.py <video> [--color green] [--roi x0,y0,x1,y1 as fractions]

`PROGRESS <0-100>` on stderr; one JSON object on stdout:

    {"durationMs": 70900, "fps": 30.0,
     "lines": [{"startMs": 100, "endMs": 1600, "peak": 0.041}, ...]}

v0 is CALIBRATED for the bright-green Na Khom / HoN-preview overlay. Community
uploads vary (different overlay color/position), so the color + ROI are
parameters, and a later calibration step should learn them per video. The Rust
side then intersects these line windows with audio energy for exact trims, and
OCRs the event button to label each line (HoN -> G-Maiden event map).
"""
from __future__ import annotations

import argparse
import json
import sys

import av
import numpy as np

# color presets: (G>hi) AND (G-R>d) AND (G-B>d) style masks, tuned to reject the
# yellow/orange particle confetti in the HoN preview (those have R≈G).
PRESETS = {
    "green": dict(chan=1, hi=140, d=45),
    "yellow": dict(chan=None, hi=170, d=40),  # placeholder for other overlay styles
}


def _mask_ratio(rgb: np.ndarray, preset: dict) -> float:
    a = rgb.astype(np.int16)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    if preset["chan"] == 1:  # green-dominant
        m = (G > preset["hi"]) & ((G - R) > preset["d"]) & ((G - B) > preset["d"])
    else:
        m = (R > preset["hi"]) & (G > preset["hi"]) & ((R - B) > preset["d"])
    return float(m.mean())


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--color", default="green", choices=list(PRESETS))
    ap.add_argument("--roi", default="0.23,0.14,0.82,0.36",
                    help="overlay region as x0,y0,x1,y1 fractions of frame")
    ap.add_argument("--step", type=int, default=3, help="sample every Nth frame")
    ap.add_argument("--merge-gap-ms", type=int, default=350)
    ap.add_argument("--min-line-ms", type=int, default=500)
    args = ap.parse_args()

    fx0, fy0, fx1, fy1 = (float(v) for v in args.roi.split(","))
    preset = PRESETS[args.color]

    c = av.open(args.video)
    vs = c.streams.video[0]
    tb = float(vs.time_base)
    dur_s = float(c.duration) / 1_000_000 if c.duration else 0.0
    fps = float(vs.average_rate) if vs.average_rate else 30.0
    W, H = vs.codec_context.width, vs.codec_context.height
    x0, y0, x1, y1 = int(fx0 * W), int(fy0 * H), int(fx1 * W), int(fy1 * H)

    ts: list[float] = []
    ratios: list[float] = []
    i = 0
    for frame in c.decode(vs):
        i += 1
        if i % args.step:
            continue
        t = float(frame.pts * tb) if frame.pts is not None else (i / fps)
        roi = frame.to_ndarray(format="rgb24")[y0:y1, x0:x1]
        ts.append(t)
        ratios.append(_mask_ratio(roi, preset))
        if dur_s > 0 and int(t) % 5 == 0:
            print(f"PROGRESS {min(99, round(100 * t / dur_s))}", file=sys.stderr, flush=True)
    c.close()

    gr = np.array(ratios)
    ta = np.array(ts)
    peak = float(gr.max()) if len(gr) else 0.0
    thr = max(0.004, peak * 0.18)  # adaptive; bimodal signal makes this robust
    on = gr > thr

    # runs of "on" -> raw line windows
    segs: list[list[float]] = []
    start = None
    for k, o in enumerate(on):
        if o and start is None:
            start = ta[k]
        elif not o and start is not None:
            segs.append([start, ta[k - 1]])
            start = None
    if start is not None:
        segs.append([start, ta[-1]])

    # merge short gaps, drop too-short blips
    merged: list[list[float]] = []
    gap = args.merge_gap_ms / 1000
    for s in segs:
        if merged and s[0] - merged[-1][1] < gap:
            merged[-1][1] = s[1]
        else:
            merged.append(s)
    min_line = args.min_line_ms / 1000
    lines = [
        {"startMs": round(a * 1000), "endMs": round(b * 1000), "peak": round(peak, 4)}
        for a, b in merged
        if b - a >= min_line
    ]

    print(json.dumps({"durationMs": round(dur_s * 1000), "fps": fps, "lines": lines},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
