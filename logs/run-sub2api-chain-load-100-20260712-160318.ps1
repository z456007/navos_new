$ErrorActionPreference='Continue'
try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}
Set-Location 'E:\navos-new'
$env:LOAD_MODE='real'
$env:SUB2API_BASE_URL='http://127.0.0.1:3000/v1'
$env:SUB2API_API_KEY='sk-local-openai-zgm2003'
$env:SUB2API_CODEX_API_KEY='sk-local-openai-zgm2003'
$env:SUB2API_CLAUDE_API_KEY='sk-local-claude-zgm2003'
$env:SUB2API_DEEPSEEK_API_KEY='sk-local-deepseek-zgm2003'
$env:SUB2API_IMAGE_API_KEY='sk-local-openai-zgm2003'
$env:SUB2API_SEEDANCE_API_KEY='sk-local-seedance-zgm2003'
$env:LOAD_PRODUCTION_100='true'
$env:LOAD_SCENARIO_PARALLEL='true'
$env:LOAD_REQUESTS_PER_SCENARIO='100'
$env:LOAD_CONCURRENCY='100'
$env:LOAD_MIXED_ALL='false'
$env:LOAD_TIMEOUT_MS='900000'
$env:LOAD_REPORT_TIME_ZONE='Asia/Shanghai'
Write-Host "START 2026-07-12T16:03:18.8937614+08:00"
Write-Host "BASE_URL=$env:SUB2API_BASE_URL"
Write-Host "SCENARIOS=100 codex + 100 claude vision + 100 deepseek + 100 gpt-image-2 mixed + 100 seedance reference video"
npm run load:sub2api-chain
Write-Host "EXIT_CODE=$LASTEXITCODE"
Write-Host "END 2026-07-12T16:03:18.8937614+08:00"
exit $LASTEXITCODE
