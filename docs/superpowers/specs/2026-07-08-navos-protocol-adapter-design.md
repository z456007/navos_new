# Navos Protocol Adapter Design

## Goal

Build a small protocol adapter in `E:\navos-new` that replaces the old mixed workspace with a focused backend service. It should expose clean local APIs for authentication, authorized account registration, upload, video task creation/polling, and model reverse proxying.

## Scope

The first version implements protocol boundaries only. It does not copy old runtime data, hardcoded secrets, Electron launchers, media caches, attack scripts, or asar extraction directories.

## Architecture

The service is a TypeScript Node.js app:

- `server/` owns HTTP routes and request authentication.
- `protocols/` owns upstream wire protocols and payload normalization.
- `store/` owns the minimal account/session source.
- `config/` owns environment parsing.

All upstream credentials come from environment variables. Registration is a thin authorized protocol wrapper; it does not automate mailbox abuse, bypass verification, or hardcode private signing keys.

## API Surface

- `GET /health`
- `POST /api/register`
- `POST /api/uploads`
- `POST /api/video/generations`
- `GET /api/video/generations/:taskId`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/messages`

## Error Model

Local authentication failures return HTTP `401`. Missing account state returns `503`. Upstream failures return the upstream status when possible and a normalized JSON error body.

