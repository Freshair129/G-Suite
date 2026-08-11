/**
 * Overlay Lab view state that outlives both a tab switch and an app restart.
 *
 * App.tsx swaps tabs by conditional render, so OverlayLab unmounts and its
 * useState dies; the module-level cache below fixes that. Surviving a *restart*
 * needs storage, and the three things worth keeping have very different shapes:
 *
 *  - surface + eventId are a few bytes → localStorage, written synchronously.
 *  - the screenshot is a multi-megabyte image → IndexedDB as a Blob.
 *
 * The screenshot deliberately does NOT go in localStorage. A 1920×1080 capture
 * as a data URL is comfortably over the ~5MB origin quota, so it would either
 * throw QuotaExceededError or, worse, evict the saved project alongside it.
 * IndexedDB stores the Blob itself — no base64 inflation, no quota cliff.
 *
 * None of this belongs in useStudioStore: that persists the *project* (source,
 * clips, layout, banner edits). Where the user happened to be looking is view
 * state, and mixing the two would put a screenshot inside the project payload.
 */

const KEY = "gann-lab-view";
const DB = "gann-lab";
const STORE = "view";
const SHOT = "screenshot";

export type LabSurface = "banner" | "hud";

export type LabView = {
  surface: LabSurface;
  eventId: string;
  /** Object URL for the loaded screenshot; null when using the bundled reference. */
  screenUrl: string | null;
};

/** Live values, shared by every mount of OverlayLab within this session. */
export const labView: LabView = { surface: "banner", eventId: "kill", screenUrl: null };

// ── small settings ─────────────────────────────────────────────────────────
try {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const saved = JSON.parse(raw) as Partial<LabView>;
    if (saved.surface === "banner" || saved.surface === "hud") labView.surface = saved.surface;
    if (typeof saved.eventId === "string") labView.eventId = saved.eventId;
  }
} catch {
  /* corrupt or unavailable storage must never stop the lab from opening */
}

function saveSmall() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ surface: labView.surface, eventId: labView.eventId }));
  } catch {
    /* quota or private mode — losing the last surface is not worth an error */
  }
}

export function setLabSurface(surface: LabSurface) {
  labView.surface = surface;
  saveSmall();
}

export function setLabEventId(eventId: string) {
  labView.eventId = eventId;
  saveSmall();
}

// ── screenshot ─────────────────────────────────────────────────────────────
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function put(value: Blob | null) {
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  if (value) store.put(value, SHOT);
  else store.delete(SHOT);
}

/**
 * Replace the stored screenshot and hand back a fresh object URL.
 * Revokes the previous URL, so exactly one stays alive at a time.
 */
export async function setLabScreenshot(file: Blob | null): Promise<string | null> {
  if (labView.screenUrl) URL.revokeObjectURL(labView.screenUrl);
  labView.screenUrl = file ? URL.createObjectURL(file) : null;
  void put(file);
  return labView.screenUrl;
}

/**
 * Restore the screenshot saved by a previous run. Returns null when there is
 * none — the caller then falls back to the bundled Dota reference.
 * Safe to call repeatedly: once a URL exists in this session it is reused.
 */
export async function restoreLabScreenshot(): Promise<string | null> {
  if (labView.screenUrl) return labView.screenUrl;
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(SHOT);
    req.onsuccess = () => {
      const blob = req.result as Blob | undefined;
      if (!blob) return resolve(null);
      labView.screenUrl = URL.createObjectURL(blob);
      resolve(labView.screenUrl);
    };
    req.onerror = () => resolve(null);
  });
}
