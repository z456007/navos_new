$ErrorActionPreference='Continue'
try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}
Set-Location 'E:\navos-new'
$env:SUB2API_BASE_URL='http://127.0.0.1:3000/v1'
$env:SUB2API_API_KEY='sk-placeholder-openai'
$env:SUB2API_CODEX_API_KEY='sk-placeholder-openai'
$env:SUB2API_CLAUDE_API_KEY='sk-placeholder-claude'
$env:LOAD_LANGUAGE_CONCURRENCY='1000'
$env:LOAD_LANGUAGE_REQUESTS='1000'
$env:LOAD_TIMEOUT_MS='1200000'
$env:LOAD_PROGRESS_INTERVAL_MS='5000'
$env:LOAD_REPORT_PATH='docs/diagnostics/2026-07-12-language-long-1000-20260712-200500.md'
Write-Host "START 2026-07-12T20:05:00.2137977+08:00"
Write-Host 'BASE_URL=http://127.0.0.1:3000/v1'
Write-Host 'SCENARIOS=1000 gpt-5.5 long chat + 1000 claude-opus-4-8 long messages, parallel'
node 'logs/load/language-long-1000-20260712-200500.mjs'
Write-Host "EXIT_CODE=$LASTEXITCODE"
Write-Host "END 2026-07-12T20:05:00.2137977+08:00"
exit $LASTEXITCODE
