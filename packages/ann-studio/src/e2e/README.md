# Responsive browser regression

Run `pnpm -C packages/ann-studio/src test:responsive` after `pnpm install` and `pnpm -C packages/ann-studio/src exec playwright install chromium`. To use an existing Chromium-compatible executable, set `CHROMIUM_PATH` to its absolute path instead.

The test starts its own Vite server on 127.0.0.1:5175 and uses a synthetic browser-only Zustand fixture with 101 clips and the event catalog. It checks viewport transitions, button text and clip-card containment, preserved clip text, visible actions, the Agent drawer, and the populated library dialog at simulated 150% CSS zoom. It repeats the viewport checks at browser device-pixel ratios 1, 1.25 and 1.5. This is not a Tauri integration test, Windows display-scale test, audio test, or proof of every dialog or library state.
