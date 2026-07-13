# Contributing

Thanks for helping improve Navos Protocol Adapter.

## Development Setup

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
npm run dev:web
```

Fill `.env` with your own local values. Do not commit `.env`.

## Project Layout

```text
src/      Fastify server, protocol adapters, services, stores
web/src/  React admin console
tests/    Vitest test suite
docs/     Public docs and internal notes
```

## Before Sending Changes

Run:

```powershell
npm run typecheck
npm test
npm run build
git diff --check
```

For targeted changes, also run the closest focused test file first.

## Code Style

- Use TypeScript and ESM imports.
- In backend source/tests, import local TypeScript modules with `.js` specifiers because the project uses `NodeNext`.
- Keep `.env` for bootstrap-only settings; runtime/business knobs should live in the Web control panel and DB-backed runtime config when possible.
- Do not reintroduce backend `/admin`; the admin UI is the Vite/React console.

## Documentation and Diagnostics

- Public user-facing docs belong under `README.md` or `docs/api/`.
- Internal investigation notes belong under `docs/internal/`.
- Runtime logs, load-test output, database files, and generated artifacts should stay untracked.

## Secret Hygiene

Do not commit:

- real API keys or tokens
- account `uid` / `token` pairs
- `.env`
- logs containing request headers or provider responses
- database dumps

Use placeholders such as:

```text
sk-placeholder-openai
sk-your-master-key
https://provider.example.com
```
