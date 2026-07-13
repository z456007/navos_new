# Security Policy

## Supported Versions

This repository currently tracks security fixes on the default branch.

## Reporting a Vulnerability

Please do not open a public issue with secrets, credentials, request logs, or exploit details.

For private reports, contact the maintainer through the repository owner profile or the preferred contact channel listed on the project page. Include:

- affected commit or version
- affected endpoint or module
- reproduction steps
- expected impact
- any relevant logs with secrets removed

## Secrets and Deployment

- Never commit `.env`, database dumps, Redis data, logs, account tokens, API keys, or provider credentials.
- Keep `MASTER_API_KEY` separate from `PUBLIC_PROXY_API_KEYS`.
- Treat any key that has appeared in logs, screenshots, diagnostics, shell history, or Git history as exposed and rotate it before public deployment.
- Run the Web control panel behind a trusted network, VPN, or gateway.

## Recommended Pre-Publish Checks

```powershell
git grep -n -E "zgm2003|sk-local-openai|sk-local-claude|sk-local-deepseek|sk-local-seedance|MASTER_API_KEY=zgm2003" -- .
npm run typecheck
npm test
npm run build
```
