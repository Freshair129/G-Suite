# Studio monorepo Implementation Plan

> **For agentic workers:** Execute inline using superpowers:executing-plans. The user approved the architecture and implementation sequence; proceed with CR-01.

**Goal:** Import a buildable, independent 3D Studio shell without moving production data.
**Architecture:** Existing pnpm workspace, two app packages, external configurable asset roots.
**Tech Stack:** pnpm 9, Tauri 2, React 18/19 kept independent, Rust.
**Spec:** ../../architecture/ADR-001-studio-monorepo.md and ../../change-requests/CR-SUITE-001.md.

## Global Constraints
- Preserve external production files and running G-Maiden.
- CR-01 only; no empty shared packages, Rust crate relocation or GANN changes.
- Work on a new branch based on current origin/main; retain earlier PR-A branch.

## Review Focus
- Unset settings: show status/list without creating external folders.
- Relative/empty overrides: reject before filesystem writes.
- Names, reserved names and existing destinations: reject without overwrite.
- Spaces/Thai in roots: preserve exact paths without shell interpolation.
- Independent dev/build: no port clash or Blender requirement to compile.

## Tasks
- [x] Import only shell files and record original hashes; exclude production trees.
- [x] Write workspace regression tests, observe missing-module failure, implement pure path/project helpers.
- [x] Wire helpers into Tauri commands; remove hard-coded paths and read-side mkdir.
- [x] Add independent root commands, migration/architecture docs and test runner.
- [x] Install pinned workspace dependencies; build both frontends and test AnnStudio.
- [x] Run Studio Rust checks/format and independent code review; fix findings.
- [x] Record checks and remaining native acceptance, commit and prepare PR for review.
