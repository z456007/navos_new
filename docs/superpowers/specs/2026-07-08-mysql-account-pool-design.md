# MySQL Account Pool Design

## Goal

Add account import and session management backed by local MySQL. Model reverse proxy routes should use an active account from the pool instead of relying only on one account in `.env`.

## Scope

This feature supports manual account import, listing, enable/disable, cooldown, least-recently-used account selection, and MySQL schema setup. It does not implement automated third-party account registration.

## Architecture

- `src/store/account-store.ts` defines the account model, store interface, and in-memory implementation for tests.
- `src/store/mysql-account-store.ts` implements the same interface with `mysql2/promise`.
- `src/services/account-service.ts` validates imports and coordinates account selection.
- `src/server/app.ts` exposes protected account management routes and uses `AccountService.pickAccount()` for provider auth.
- `src/index.ts` initializes MySQL schema before starting the server.

## MySQL

Runtime uses:

- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`

The local `.env` can use root/root. `.env.example` must keep placeholders only.

## API Surface

- `POST /api/accounts/import`
- `GET /api/accounts`
- `GET /api/accounts/:uid`
- `POST /api/accounts/:uid/enable`
- `POST /api/accounts/:uid/disable`
- `POST /api/accounts/:uid/cooldown`

