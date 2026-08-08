// Optional Google sign-in against the shared gstore project (GID hub,
// SPEC-2026-08-09 §4). Signing in only fills authorGid/display-name for
// exported packs — every authoring flow works signed-out.
import { createClient } from "@supabase/supabase-js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { useStudioStore } from "../store/useStudioStore";

const GSTORE_URL = "https://wsseitulmcgnolgsrxgh.supabase.co";
const GSTORE_PUBLISHABLE_KEY = "sb_publishable__vr0-aNdudlq3aPbH8OMXw_0rr0JScZ";
const OAUTH_REDIRECT = "http://127.0.0.1:3210/auth/callback";

export const gidSupabase = createClient(GSTORE_URL, GSTORE_PUBLISHABLE_KEY, {
  auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

async function loadProfileIntoStore(): Promise<void> {
  const { data: { user } } = await gidSupabase.auth.getUser();
  if (!user) return;
  const { data: profile } = await gidSupabase
    .from("profiles")
    .select("gid_code, display_name")
    .eq("id", user.id)
    .maybeSingle<{ gid_code: string | null; display_name: string | null }>();
  useStudioStore.getState().setGidAuth({
    gid: profile?.gid_code ?? "",
    displayName: profile?.display_name ?? user.user_metadata?.full_name ?? "",
    signedIn: true,
  });
}

/** Restore a persisted session on app start (no network prompt). */
export async function restoreGidSession(): Promise<void> {
  const { data: { session } } = await gidSupabase.auth.getSession();
  if (session?.user) await loadProfileIntoStore();
}

/** Returns an error message, or null on success. */
export async function signInWithGoogle(): Promise<string | null> {
  try {
    const { data, error } = await gidSupabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: OAUTH_REDIRECT, skipBrowserRedirect: true },
    });
    if (error || !data?.url) return error?.message ?? "เริ่ม OAuth ไม่สำเร็จ";
    const listen = invoke<string>("gid_oauth_listen"); // arm listener BEFORE opening the browser
    await open(data.url);
    const query = await listen;
    const code = new URLSearchParams(query).get("code");
    if (!code) return "callback ไม่มี authorization code";
    const { error: xErr } = await gidSupabase.auth.exchangeCodeForSession(code);
    if (xErr) return xErr.message;
    await loadProfileIntoStore();
    return null;
  } catch (e) {
    return (e as { message?: string })?.message ?? String(e);
  }
}

export async function signOutGid(): Promise<void> {
  await gidSupabase.auth.signOut();
  useStudioStore.getState().setGidAuth({ gid: "", displayName: "", signedIn: false });
}
