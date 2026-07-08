# Navos Protocol Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a clean TypeScript protocol adapter for auth, authorized registration, upload, video task handling, and model reverse proxying.

**Architecture:** Fastify exposes local HTTP routes. Focused protocol modules wrap upstream requests with injected fetch for testability. The first store is in-memory and can be replaced by SQLite later without changing protocol code.

**Tech Stack:** Node.js 22, TypeScript, Fastify, Vitest, built-in `fetch`/`FormData`.

---

## File Map

- Create `.gitignore`: ignore dependencies, build output, env files, logs, and local databases.
- Create `package.json`: scripts and dependencies.
- Create `tsconfig.json`: strict TypeScript build.
- Create `vitest.config.ts`: unit test config.
- Create `.env.example`: documented runtime config.
- Create `src/config/env.ts`: environment parsing.
- Create `src/protocols/auth.ts`: local auth guard and upstream auth headers.
- Create `src/protocols/http.ts`: typed upstream HTTP client.
- Create `src/protocols/register.ts`: authorized registration wrapper.
- Create `src/protocols/upload.ts`: data URL / remote URL upload wrapper.
- Create `src/protocols/video.ts`: video task creation, polling, status normalization.
- Create `src/protocols/model-proxy.ts`: OpenAI/Anthropic-compatible reverse proxy forwarding.
- Create `src/store/account-store.ts`: minimal in-memory account source.
- Create `src/server/app.ts`: Fastify route wiring.
- Create `src/index.ts`: runtime entrypoint.
- Create `tests/*.test.ts`: focused unit and route tests.

### Task 1: Project Setup

- [ ] Create package and TypeScript config.
- [ ] Install dependencies with `npm install`.
- [ ] Add tests that import the intended protocol APIs before implementation.
- [ ] Run `npm test` and confirm failures are caused by missing modules.

### Task 2: Auth and Config

- [ ] Implement `loadConfig(env)` to parse required and optional settings.
- [ ] Implement `isClientAuthorized(headers, masterApiKey)` for `x-api-key` and `Authorization: Bearer`.
- [ ] Implement `buildProviderAuthHeaders(account, mode)` for `bearer-token`, `uid-token`, and `none`.
- [ ] Run `npm test -- tests/auth.test.ts tests/config.test.ts`.

### Task 3: Provider HTTP Client

- [ ] Implement `ProviderHttpClient.requestJson()`.
- [ ] Preserve upstream status and JSON body for success and failure.
- [ ] Run `npm test -- tests/http-client.test.ts`.

### Task 4: Upload Protocol

- [ ] Implement data URL parsing into `Blob` + `FormData`.
- [ ] Implement remote URL upload forwarding as JSON.
- [ ] Run `npm test -- tests/upload.test.ts`.

### Task 5: Video Protocol

- [ ] Implement `normalizeVideoTaskStatus()`.
- [ ] Implement `createVideoTask()` and `getVideoTask()`.
- [ ] Run `npm test -- tests/video.test.ts`.

### Task 6: Model Reverse Proxy

- [ ] Implement path-safe forwarding for `/v1/models`, `/v1/chat/completions`, and `/v1/messages`.
- [ ] Reject unsupported proxy paths.
- [ ] Run `npm test -- tests/model-proxy.test.ts`.

### Task 7: Server Routes

- [ ] Wire Fastify routes to protocol modules.
- [ ] Enforce local auth on all non-health endpoints.
- [ ] Run `npm test -- tests/server.test.ts`.

### Task 8: Verification

- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.

