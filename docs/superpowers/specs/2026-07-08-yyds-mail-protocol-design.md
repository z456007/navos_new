# YYDS Mail Protocol Design

## Goal

Add a focused YYDS Mail protocol client for creating temporary mailboxes and reading verification emails in authorized workflows.

## Scope

This feature only integrates YYDS Mail itself:

- create a mailbox with an API key
- list mailbox messages
- fetch one message detail
- extract a 4-8 digit verification code from message text

It does not automate third-party account farming, quota abuse, or unattended bulk registration flows.

## Architecture

The client lives in `src/protocols/mail/yyds-mail.ts` and accepts an injected `fetch` implementation for testing. Configuration extends `loadConfig()` with `YYDS_MAIL_API_KEY` and `YYDS_MAIL_BASE_URL`. HTTP routes expose mailbox creation and code lookup behind the existing local API key guard.

## API Surface

- `POST /api/mail/yyds/accounts`
- `GET /api/mail/yyds/messages?address=...&token=...`
- `GET /api/mail/yyds/messages/:messageId?address=...&token=...`
- `POST /api/mail/yyds/verification-code`

## Error Model

YYDS responses with `success: false` become `YydsMailError`. HTTP routes return normalized JSON errors and do not expose the YYDS API key.

