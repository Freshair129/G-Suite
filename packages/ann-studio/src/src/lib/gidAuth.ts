// Google sign-in plus the server-side G-AnnStudio developer/collaborator gate.
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

async function authorizeStudio(accessToken: string): Promise<string | null> {
  try {
    await invoke("studio_authorize", { accessToken });
    useStudioStore.getState().setStudioAccess("authorized");
    void loadProfileIntoStore().catch(() => {});
    return null;
  } catch (e) {
    const message = (e as { message?: string })?.message ?? String(e);
    await invoke("studio_access_clear").catch(() => {});
    useStudioStore.getState().setGidAuth({ gid: "", displayName: "", signedIn: false });
    useStudioStore.getState().setStudioAccess("denied", message);
    return message;
  }
}

/** Restore a session and recheck server-side collaborator access on app start. */
export async function restoreGidSession(): Promise<void> {
  if (useStudioStore.getState().studioAccess !== "authorized") {
    useStudioStore.getState().setStudioAccess("checking");
  }
  try {
    const { data: { session }, error } = await gidSupabase.auth.getSession();
    if (error || !session?.user) {
      await invoke("studio_access_clear").catch(() => {});
      useStudioStore.getState().setGidAuth({ gid: "", displayName: "", signedIn: false });
      useStudioStore.getState().setStudioAccess("denied", "เข้าสู่ระบบด้วยบัญชี Google ที่ได้รับสิทธิ์ผู้พัฒนาหรือผู้ร่วมงาน");
      return;
    }
    await authorizeStudio(session.access_token);
  } catch {
    await invoke("studio_access_clear").catch(() => {});
    useStudioStore.getState().setGidAuth({ gid: "", displayName: "", signedIn: false });
    useStudioStore.getState().setStudioAccess("denied", "ตรวจสอบสิทธิ์ G-AnnStudio ไม่ได้ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองอีกครั้ง");
  }
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
    const { data: { session }, error: sessionError } = await gidSupabase.auth.getSession();
    if (sessionError || !session) return sessionError?.message ?? "เข้าสู่ระบบไม่สำเร็จ";
    return authorizeStudio(session.access_token);
  } catch (e) {
    return (e as { message?: string })?.message ?? String(e);
  }
}

export async function signOutGid(): Promise<void> {
  await gidSupabase.auth.signOut();
  await invoke("studio_access_clear").catch(() => {});
  useStudioStore.getState().setGidAuth({ gid: "", displayName: "", signedIn: false });
  useStudioStore.getState().setStudioAccess("denied", "เข้าสู่ระบบด้วยบัญชีผู้พัฒนาหรือผู้ร่วมงานเพื่อใช้งาน G-AnnStudio");
}
