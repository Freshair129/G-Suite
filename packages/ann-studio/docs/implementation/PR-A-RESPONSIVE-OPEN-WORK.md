# PR-A responsive acceptance: remaining work

Snapshot: 2026-11-02. PR [#18](https://github.com/Freshair129/G-Suite/pull/18), issue [#13](https://github.com/Freshair129/G-Suite/issues/13), implementation head `f0e4951` (this note may be committed later). Base: `design/annstudio-glass-responsive-v1`.

PR-A is still a draft. The user has explicitly said not to merge. The idea of a limited internal MVP was discussed, but the user has not waived the acceptance criteria or authorized a merge. The [change request](../change-requests/CR-ANN-UI-001.md), [design system](../design-system/GLASS-RESPONSIVE-UI-v1.md), and [handoff](CODEX-HANDOFF-ANN-UI-001.md) remain the binding requirements. PR-B through PR-D / issues #14–#16 follow the dependency order in epic #17 after PR-A's gate.

The PR description is the detailed chronological evidence ledger. Read its latest entries as well as this summary; older entries can describe gaps that later work partially addressed. Recheck the PR head, review and checks before making any current claim.

## Evidence already collected, with limits

- At `f0e4951`, frontend Vitest passed 152 tests; TypeScript/Vite production build passed with an existing >500 kB chunk warning; the responsive browser suite passed five viewport sizes at emulated DPR 1, 1.25 and 1.5. It also exercises populated dialogs, connected Profile, Agent draft preservation, event names and 125% CSS-zoom containment of event install actions. Browser emulation and CSS zoom do not establish Windows DPI or native WebView zoom acceptance. No hosted checks were reported at that time.
- The real Tauri dev app was captured at measured client sizes 960×600, 1024×768, 1280×720 and 1440×900 at DPR 1, in selected states. The 1440×900 [Studio](screenshots/pr18-native-editor-1440x900-diagnostic.png) and [event Test](screenshots/pr18-native-24events-client-1440x900-diagnostic.png) captures use a generated 101-clip, 24-event mixed Thai/English fixture. Other 101-clip evidence used a single-event fixture. Neither is proof of every control and workflow at every size. The test-only metrics badge obscures part of the UI.
- Windows scale 125% and 150% produced visible WebView DPR 1.25 and 1.5 in diagnostics, but capture artifacts and stale accessibility badge text prevent a visual/interaction pass. Scale was restored to 100%. A maximized 1920×1009 client capture is not the required 1920×1080 client.
- A limited native smoke imported a WAV, mapped a clip, undid/redid it, saved/reopened a project, showed preview meter activity, and built/exported a one-event GANN with matching SHA-256. An isolated G-Maiden profile accepted that one-event artifact; its isolated selection later showed it active and the installed file matched the export hash. No independent audible playback, real-match transition, production-profile installation, or full audio workflow was established.
- Native checks covered selected drawer/menu/dialog focus restoration, mastering slider keyboard adjustments and undo, and accessibility names for event preview buttons. These do not constitute a complete keyboard audit or an actual screen-reader test. A zero-clip error was shown as an accessibility alert; the stale error after opening another project was fixed and regression-tested.

## Open work and handoff checklist

Check these against the current candidate and record exact head, environment, steps, result and screenshot paths. A partial result must remain partial; do not promote diagnostic or synthetic evidence to a native pass.

- [ ] **Native viewport and screenshots:** complete selected-state and interaction coverage at the required sizes, including actual 1920×1080 and 2560×1440 clients. The previously used display reported 1920×1080, so a suitable larger display or equivalent test environment is needed for the larger native client. Capture before/after evidence for wide, medium and compact layouts and inspect clipping, text, controls, rails and shell scrolling.
- [ ] **DPI and text zoom:** complete visual and interaction checks at actual Windows 100%, 125% and 150% scaling and native WebView text zoom 100% and 125%. Verify effective values independently, capture usable screenshots without obscuring controls, and restore the original display settings. Existing high-DPI captures are diagnostic only.
- [ ] **Keyboard and accessibility:** audit all controls and dialogs using Tab/Shift-Tab, focus visibility and restoration, Escape, keyboard rail controls, and a real screen reader. Verify labels and reachability at compact and high-DPI settings.
- [ ] **Native scenarios:** cover absent source, missing/long model names, busy, error/retry, toast and confirmation states; verify long Thai/English text, 80-character titles and the 24-event / 100+ clip project throughout relevant views.
- [ ] **Workflows:** exercise audio editing and audible playback, resize during audition, banner view, save/reopen, build/export, AI chat and resize during chat. Verify no loss of selection or unsaved state. The prior Agent check preserved an unsent draft across resizing; it did not send a live AI message.
- [ ] **Install and review:** extend the bounded isolated install evidence as needed to the intended MVP workflow, including audible playback and real-match activation if claimed. Obtain an appropriate GitHub review and confirm current required checks. Do not merge without renewed user authorization and either completing or explicitly agreeing to a change in the existing acceptance gate.

If the user later chooses an internal-only MVP with deferred checks, document the exact supported audience, environments and accepted risks in the PR before changing its status. A proposed deferral is not itself approval or completed acceptance.

## Safe continuation

Do not disturb another active G-Maiden test, its profile, processes or global shortcuts. Check current process ownership before native work and use isolated data for install testing. Restore display settings after DPI work and preserve unrelated files. The local disposable fixtures and isolated runtime used previously live outside the repository and may no longer exist; verify them before use rather than assuming they are reproducible or current.

Useful commands from the repository root, subject to installed dependencies and browser path:

```powershell
npx --yes pnpm@9.0.0 -C packages/ann-studio/src test
npx --yes pnpm@9.0.0 -C packages/ann-studio/src build
$env:CHROMIUM_PATH = '<installed Chrome executable>'
npx --yes pnpm@9.0.0 -C packages/ann-studio/src test:responsive
cargo test --manifest-path packages/ann-studio/src-tauri/gann-package/Cargo.toml
```

There is no package ESLint script/configuration in this snapshot. Do not report it as run. The native metrics Vite config is `src/e2e/native-metrics.config.mjs`; it is test-only and its overlay can hide controls, so inspect and report its limitations.
