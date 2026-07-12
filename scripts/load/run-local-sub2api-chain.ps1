param(
  [string]$Sub2ApiBaseUrl = "http://127.0.0.1:3000/v1",
  [string]$Sub2ApiApiKey = "sk-local-openai-zgm2003",
  [string]$Concurrency = "100,300,1000"
)

$ErrorActionPreference = "Stop"
$env:SUB2API_BASE_URL = $Sub2ApiBaseUrl
$env:SUB2API_API_KEY = $Sub2ApiApiKey
$env:LOAD_CONCURRENCY = $Concurrency

Write-Host "Running Sub2Api chain load test against $Sub2ApiBaseUrl"
npm run load:sub2api-chain
