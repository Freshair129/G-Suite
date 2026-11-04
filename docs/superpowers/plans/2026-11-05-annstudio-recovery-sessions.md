# AnnStudio Recovery Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement and verify the tasks in order.

**Goal:** Allow deliberate reopening and saving of older project archives without losing newer recovery, while rejecting writes from superseded sessions.

**Architecture:** Open has separate inspection and activation phases. Native project locks protect session validation, recovery retention and writes. Preserve divergent recovery snapshots as separately discoverable candidates, keep project identity stable, and allocate a safe new generation on activation. An opaque session token accompanies every project mutation, including asynchronous build completion.

**Tech Stack:** Rust/Tauri, TypeScript/React, Vitest and Windows hosted Rust CI.

**Spec:** `packages/ann-studio/docs/change-requests/CR-ANN-UI-001.md`, PR #22 review and regression tests in `packages/ann-studio/src-tauri/src/project_io_tests.rs`.

## Global Constraints

- Preserve project IDs, announcer IDs, existing `.ann` files and newer recovery candidates; never silently replace unsaved work.
- Use the existing project lock and preserve existing functionality; enforce safe-integer generation bounds.
- Do not run local Cargo builds until the machine's storage and lane gates are met; keep G-Maiden undisturbed.
- Validate exact-head hosted CI, review and installed/native UAT before merge; do not delete a protected checkout.

## Review Focus

- Interrupted retention or activation leaves the prior usable session and recovery intact.
- A stale save, autosave, import or build completion after activation cannot write the new session's state.
- Editing while open is pending does not silently discard user changes or revoke their active session.
- Divergent recovery at the same generation and archived candidates survive application restart.
- Concurrent project sessions targeting the same destination need an explicit destination-level conflict policy.
- Candidate listing must not eagerly generate project-sized archives; materialize only the explicitly selected candidate, bound its writes and validate any existing artifact before use.
- Recovery history remains discoverable when the active recovery document is missing; synchronize listing and selected-candidate materialization with project writes.
- Report damaged or unreadable candidates as visible warnings without hiding other valid candidates; never delete damaged evidence.
- Read recovery data from bounded, verified handles with reparse-point protections, not a path check followed by an unbounded path read; define deterministic ordering and candidate identity.

## Task 1: Recovery candidates and session fencing

**Files:** `packages/ann-studio/src-tauri/src/project_io.rs`, `project_io_tests.rs`, `lib.rs`, `build_jobs.rs`.

- [ ] Confirm the existing older-archive regression fails at the guard and add tests for same-generation divergence, retained-candidate enumeration after restart, activation failure and safe-integer overflow.
- [ ] Define a native session token generated on accepted activation, checked under the project lock before save, prepare, import and build commit. Add delayed-writer regressions for each path.
- [ ] Retain a divergent recovery as an atomically written uniquely named document before replacing active recovery; list candidate metadata without activating a session or building archives. Materialize and verify only the selected candidate under the project lock, including the history-only case.
- [ ] Activate a validated archive in two phases, assign a generation above all relevant snapshots, preserve lineage and expose the session token. Recheck the caller's accepted origin before activation.
- [ ] Run hosted Windows Rust CI; verify every new regression and existing round-trip passes. Commit scoped changes.

## Task 2: Frontend session lifecycle and conflict handling

**Files:** `packages/ann-studio/src/src/lib/project.ts`, `packProject.ts`, related project/build tests and relevant UI components.

- [ ] Add regressions for edits during an open dialog/activation, stale asynchronous results, opening retained recovery candidates, Save and Save As of an older archive, and normal import/build after activation.
- [ ] Carry the opaque token through snapshot and native mutation calls; gate edits during activation and preserve the current editor when activation fails.
- [ ] Present retained candidates clearly and ensure a user can open either the selected archive or a retained recovery without hidden identity changes.
- [ ] Run frontend and hosted native checks on the exact candidate; update PR evidence and request independent review.

## Task 3: Integration and acceptance

- [ ] Reconcile with responsive PR-A and cover `PackWorkflow.tsx`; run applicable checks on the actual integration candidate.
- [ ] When G-Maiden testing permits, complete installed native viewport/DPI, focus, audio and installer workflow UAT while preserving existing data.
- [ ] Resolve review findings, verify prerequisite PRs and branch protection, merge only when all required gates pass, then assess checkout ownership and recovery independently before any deletion.
