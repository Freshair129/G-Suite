// Generate an AI banner image for an event and return it as a BannerOverride,
// so it flows through the same install/preview path as an uploaded image.
// Backend = a local Stable Diffusion WebUI (A1111 --api); throws with a clear
// message if it isn't reachable so the caller can surface it.

import { invoke } from "@tauri-apps/api/core";
import { bannerPrompt, BANNER_NEGATIVE } from "./bannerPrompt";
import type { BannerOverride } from "../store/useStudioStore";

export async function generateBanner(
  eventId: string,
  endpoint: string
): Promise<BannerOverride | null> {
  const b64 = await invoke<string>("generate_banner_image", {
    prompt: bannerPrompt(eventId),
    endpoint,
    negative: BANNER_NEGATIVE,
  });
  return b64 ? { b64, ext: "png", mime: "image/png" } : null;
}
