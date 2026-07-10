# Remove COS Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all COS backup/config concepts while keeping Navos-new as a Sub2Api-compatible upstream and account registrar.

**Architecture:** Keep model, image, video, account-pool, and registration routes intact. Delete COS config routes/services/archive calls so image/video responses pass upstream URLs/data through directly. Keep existing account leasing, depletion, and Sub2Api `/v1/*` behavior unchanged.

**Tech Stack:** TypeScript, Fastify, React, Vitest, Vite.

---

### Task 1: Server behavior without COS

**Files:**
- Modify: `tests/server.test.ts`
- Modify: `src/server/app.ts`
- Modify: `src/index.ts`
- Modify: `src/config/env.ts`
- Delete: `src/services/cos-config-service.ts`
- Delete: `src/services/image-archive.ts`
- Delete: `src/services/video-archive.ts`
- Delete: `src/store/cos-config-store.ts`

- [ ] Write failing tests that `/api/cos/config` is gone and image/video responses no longer gain `cosUrl`, `cosKey`, `archiveStatus`, or `archiveError`.
- [ ] Run targeted server tests and confirm failures are COS-related.
- [ ] Remove COS service/store/archive wiring from backend creation and startup.
- [ ] Make image generation return `result.body` directly after successful account consumption.
- [ ] Make video task polling return upstream normalized task data directly while preserving local task bookkeeping.
- [ ] Run targeted server tests and confirm pass.

### Task 2: Frontend and shared types without COS

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/app/ConsoleShell.tsx`
- Modify: `web/src/lib/accounts.ts`
- Modify: `web/src/lib/image-generation.ts`
- Modify: `web/src/lib/video-task.ts`
- Modify: `web/src/panels/ImagePanel.tsx`
- Modify: `web/src/panels/VideoPanel.tsx`
- Delete: `web/src/panels/CosConfigPanel.tsx`
- Delete: `web/src/lib/cos-config.ts`
- Modify: `tests/admin-app.test.tsx`
- Modify: `tests/web-lib.test.ts`

- [ ] Update failing UI/type tests to expect no COS navigation or COS fields.
- [ ] Remove COS panel imports, nav item, panel id, labels, and helper code.
- [ ] Use upstream `url` / `videoUrl` only in image/video panels.
- [ ] Run targeted frontend tests and confirm pass.

### Task 3: Config/docs cleanup and full verification

**Files:**
- Modify: `.env.example`
- Modify: docs containing active COS behavior claims if they describe current behavior.

- [ ] Remove `COS_CONFIG_SECRET` from env examples and app config.
- [ ] Search for remaining runtime COS references and remove active product concepts.
- [ ] Run `npx vitest run tests/server.test.ts tests/admin-app.test.tsx tests/web-lib.test.ts`.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build:server`, `npm run build:web`, and `git diff --check`.
