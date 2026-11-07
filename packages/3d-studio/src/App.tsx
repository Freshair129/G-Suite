import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FormEvent, useEffect, useState } from "react";
import "./App.css";

type StudioStatus = { blenderPath: string | null; blenderAvailable: boolean; blenderVersion: string | null; workspaceRoot: string };
type ProjectSummary = { id: string; state: string; provenance: string; hasBlendSource: boolean; sourceScanLimited: boolean };

export default function App() {
  const [status, setStatus] = useState<StudioStatus | null>(null);
  const [projectName, setProjectName] = useState("gmaiden-ice-mage");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [notice, setNotice] = useState("Loading local Studio status…");
  const [creating, setCreating] = useState(false);
  const [bannerProjectId, setBannerProjectId] = useState("");
  const [bannerAssetId, setBannerAssetId] = useState("banner-still-v1");
  const [bannerName, setBannerName] = useState("Banner Still");
  const [bannerRevision, setBannerRevision] = useState(1);
  const [bannerSourcePath, setBannerSourcePath] = useState("");
  const [bannerExporting, setBannerExporting] = useState(false);

  async function refreshStudio() {
    try {
      const [nextStatus, nextProjects] = await Promise.all([
        invoke<StudioStatus>("get_studio_status"),
        invoke<ProjectSummary[]>("list_projects"),
      ]);
      setStatus(nextStatus);
      setProjects(nextProjects);
      if (!bannerProjectId && nextProjects[0]) setBannerProjectId(nextProjects[0].id);
      setNotice(nextStatus.blenderAvailable ? "Blender bridge ready. Review-pending sources only." : "Set G_STUDIO_BLENDER_PATH to your Blender executable, then restart Studio.");
    } catch (error) { setNotice(String(error)); }
  }

  async function chooseBannerSource() {
    try {
      const path = await open({
        title: "Choose a still banner image",
        multiple: false,
        directory: false,
        filters: [{ name: "Raster images", extensions: ["png", "webp", "jpg", "jpeg"] }],
      });
      if (typeof path === "string") setBannerSourcePath(path);
    } catch (error) { setNotice(String(error)); }
  }

  async function exportBannerAsset() {
    if (!bannerProjectId || !bannerSourcePath) return;
    setBannerExporting(true);
    try {
      const result = await invoke<{ path: string }>("export_banner_asset", {
        projectId: bannerProjectId,
        assetId: bannerAssetId,
        name: bannerName,
        revision: bannerRevision,
        sourcePath: bannerSourcePath,
      });
      setNotice(`Banner Asset exported: ${result.path}`);
    } catch (error) { setNotice(String(error)); }
    finally { setBannerExporting(false); }
  }

  useEffect(() => { void refreshStudio(); }, []);

  async function createProject(event: FormEvent) {
    event.preventDefault(); setCreating(true);
    try {
      setNotice(`Created review-pending project: ${await invoke<string>("create_empty_project", { projectName })}`);
      await refreshStudio();
    }
    catch (error) { setNotice(String(error)); }
    finally { setCreating(false); }
  }

  return <main className="studio-shell">
    <aside className="rail" aria-label="Studio navigation"><strong>GM</strong><button aria-label="Projects">□</button><button aria-label="Assets">◇</button><button aria-label="Exports">↗</button><button aria-label="Settings">⚙</button></aside>
    <section className="workspace">
      <header><div><p>LOCAL CREATIVE PIPELINE</p><h1>G‑Maiden 3D Studio</h1></div><span className={status?.blenderAvailable ? "online" : "offline"}>{status ? (status.blenderVersion ?? "Blender not verified") : "Checking Blender"}</span></header>
      <div className="canvas"><div className="empty-orbit"><span>◇</span><p>ไม่มีโมเดลที่ผ่านการ review</p><small>สร้าง project เพื่อเริ่ม source, preview และ export manifest</small></div>
        <div className="project-list" aria-label="Local Studio projects">{projects.map((project) => <article key={project.id}><strong>{project.id}</strong><span>{project.state}</span><small>{project.hasBlendSource ? "Blender source found" : project.sourceScanLimited ? "Source list limited to the first 256 entries" : "No Blender source yet"}</small><p>{project.provenance}</p></article>)}</div>
      </div>
      <footer><span>{notice}</span><span>{status?.workspaceRoot ?? "Workspace not loaded"}</span></footer>
    </section>
    <aside className="inspector">
      <section><p className="eyebrow">BLENDER BRIDGE</p><strong>{status?.blenderAvailable ? "Blender executable configured" : "Connection unavailable"}</strong><code>{status?.blenderPath ?? "Set G_STUDIO_BLENDER_PATH before launch"}</code></section>
      <section><p className="eyebrow">LANDING EXPORT PROFILE</p><dl><div><dt>GLB transfer</dt><dd>≤ 3 MB</dd></div><div><dt>Textures</dt><dd>≤ 2 MB</dd></div><div><dt>Idle animation</dt><dd>1 baked clip</dd></div><div><dt>Fallback</dt><dd>Required</dd></div></dl></section>
      <section className="banner-export">
        <p className="eyebrow">ANNSTUDIO BANNER EXPORT · V1</p>
        <label htmlFor="banner-project">STUDIO PROJECT</label>
        <select id="banner-project" value={bannerProjectId} onChange={event => setBannerProjectId(event.target.value)} disabled={!projects.length}>
          {projects.length ? projects.map(project => <option key={project.id} value={project.id}>{project.id}</option>) : <option value="">Create or select a project first</option>}
        </select>
        <label htmlFor="banner-asset-id">ASSET ID</label>
        <input id="banner-asset-id" value={bannerAssetId} onChange={event => setBannerAssetId(event.target.value)} maxLength={128} />
        <label htmlFor="banner-name">DISPLAY NAME</label>
        <input id="banner-name" value={bannerName} onChange={event => setBannerName(event.target.value)} maxLength={120} />
        <label htmlFor="banner-revision">REVISION</label>
        <input id="banner-revision" type="number" min={1} step={1} value={bannerRevision} onChange={event => setBannerRevision(Number(event.target.value))} />
        <button type="button" onClick={() => void chooseBannerSource()} disabled={bannerExporting}>Choose PNG / WebP / JPEG</button>
        <small>{bannerSourcePath ? bannerSourcePath.split(/[\\/]/).pop() : "No image selected"}</small>
        <button type="button" onClick={() => void exportBannerAsset()} disabled={bannerExporting || !bannerProjectId || !bannerSourcePath || !bannerAssetId.trim() || !bannerName.trim() || !Number.isSafeInteger(bannerRevision) || bannerRevision < 1}>
          {bannerExporting ? "Exporting…" : "Export immutable .banner.zip"}
        </button>
        <small>Exports only still images. Each project revision is write-once. The archive contains a portable manifest and verified image bytes.</small>
      </section>
      <form onSubmit={createProject}><label htmlFor="project-name">NEW ORIGINAL-ASSET PROJECT</label><input id="project-name" value={projectName} onChange={(e) => setProjectName(e.target.value)} /><button type="submit" disabled={creating || !status?.blenderAvailable}>{creating ? "Creating…" : "Create project"}</button></form>
      <p className="guardrail">Bridge accepts only workspace-bounded projects. Arbitrary shell, Blender Python, extension installs, and publish actions are not available.</p>
    </aside>
  </main>;
}
