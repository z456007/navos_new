# YYDS Mail Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add YYDS Mail mailbox creation and verification-code retrieval as a clean protocol module.

**Architecture:** A focused `YydsMailClient` wraps the YYDS API with injected fetch. Server routes stay thin and protected by the existing local API key auth. `.env` stores the local YYDS key and remains ignored by Git.

**Tech Stack:** Node.js 22, TypeScript, Fastify, Vitest, built-in `fetch`.

---

### Task 1: Failing Tests

- [ ] Create `tests/yyds-mail.test.ts` covering account creation, message listing, message detail, code extraction, and YYDS error normalization.
- [ ] Extend `tests/config.test.ts` for YYDS environment parsing.
- [ ] Extend `tests/server.test.ts` for the protected mailbox creation route.
- [ ] Run `npm test` and confirm failure comes from missing implementation.

### Task 2: Protocol Implementation

- [ ] Create `src/protocols/mail/yyds-mail.ts`.
- [ ] Implement `YydsMailClient.createMailbox()`.
- [ ] Implement `YydsMailClient.listMessages()`.
- [ ] Implement `YydsMailClient.getMessage()`.
- [ ] Implement `extractVerificationCode()`.
- [ ] Run `npm test -- tests/yyds-mail.test.ts`.

### Task 3: Config and Routes

- [ ] Add `yydsMailApiKey` and `yydsMailBaseUrl` to `AppConfig`.
- [ ] Add protected routes under `/api/mail/yyds`.
- [ ] Run `npm test -- tests/config.test.ts tests/server.test.ts`.

### Task 4: Local Secret and Verification

- [ ] Write `.env` with `YYDS_MAIL_API_KEY` and defaults.
- [ ] Run a live mailbox creation check using `.env`.
- [ ] Run `npm test`, `npm run typecheck`, and `npm run build`.

