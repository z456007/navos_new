# MySQL Account Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a MySQL-backed account pool for manual account import, status management, cooldown, and model reverse proxy account selection.

**Architecture:** Define a small account store interface, keep an in-memory implementation for tests, add a MySQL implementation for runtime, and route provider auth through `AccountService.pickAccount()`. Server account routes remain protected by the existing local API key guard.

**Tech Stack:** Node.js 22, TypeScript, Fastify, mysql2/promise, Vitest.

---

### Task 1: Tests

- [ ] Add account service tests for import validation, import persistence, least-recently-used selection, disable, enable, and cooldown.
- [ ] Add server route tests for protected import/list routes.
- [ ] Add config tests for MySQL environment parsing.
- [ ] Run tests and confirm red failures.

### Task 2: Store Interface and Service

- [ ] Expand `src/store/account-store.ts` with `AccountRecord`, `AccountStore`, and in-memory methods.
- [ ] Create `src/services/account-service.ts` with import/list/get/pick/enable/disable/cooldown.
- [ ] Run account service tests.

### Task 3: MySQL Store

- [ ] Install `mysql2`.
- [ ] Create `src/store/mysql-account-store.ts`.
- [ ] Implement schema creation and CRUD methods.
- [ ] Keep tokens out of list responses by default at the API layer.

### Task 4: Config and Runtime

- [ ] Extend config with MySQL settings.
- [ ] Update `.env.example`.
- [ ] Update `.env` with local root/root credentials.
- [ ] Update `src/index.ts` to initialize MySQL store before `createApp()`.

### Task 5: Server Integration

- [ ] Inject `AccountService` into `createApp()`.
- [ ] Route model proxy/provider calls through `pickAccount()`.
- [ ] Add account management endpoints.
- [ ] Run route tests.

### Task 6: Verification

- [ ] Create the local MySQL database if missing.
- [ ] Run a live store smoke test against MySQL.
- [ ] Run `npm test`, `npm run typecheck`, and `npm run build`.

