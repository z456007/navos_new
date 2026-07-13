param(
  [string]$Sub2ApiBaseUrl = "http://127.0.0.1:3000/v1",
  [string]$Sub2ApiApiKey = "sk-placeholder-openai",
  [string]$Sub2ApiCodexApiKey = "sk-placeholder-openai",
  [string]$Sub2ApiClaudeApiKey = "sk-placeholder-claude",
  [string]$Sub2ApiDeepSeekApiKey = "sk-placeholder-deepseek",
  [string]$Sub2ApiImageApiKey = "sk-placeholder-openai",
  [string]$Sub2ApiSeedanceApiKey = "sk-placeholder-seedance",
  [string]$Concurrency = "100,300,1000",
  [string]$Scenarios = "",
  [string]$ImageSize = "1024x1024",
  [string]$VideoResolution = "480P",
  [int]$VideoDurationSeconds = 5,
  [string]$VideoAspectRatio = "1:1"
)

$ErrorActionPreference = "Stop"
$env:SUB2API_BASE_URL = $Sub2ApiBaseUrl
$env:SUB2API_API_KEY = $Sub2ApiApiKey
$env:SUB2API_CODEX_API_KEY = $Sub2ApiCodexApiKey
$env:SUB2API_CLAUDE_API_KEY = $Sub2ApiClaudeApiKey
$env:SUB2API_DEEPSEEK_API_KEY = $Sub2ApiDeepSeekApiKey
$env:SUB2API_IMAGE_API_KEY = $Sub2ApiImageApiKey
$env:SUB2API_SEEDANCE_API_KEY = $Sub2ApiSeedanceApiKey
$env:LOAD_CONCURRENCY = $Concurrency
$env:LOAD_SCENARIOS = $Scenarios
$env:LOAD_IMAGE_SIZE = $ImageSize
$env:LOAD_VIDEO_RESOLUTION = $VideoResolution
$env:LOAD_VIDEO_DURATION_SECONDS = [string]$VideoDurationSeconds
$env:LOAD_VIDEO_ASPECT_RATIO = $VideoAspectRatio

Write-Host "Running Sub2Api chain load test against $Sub2ApiBaseUrl"
Write-Host "Scenarios=$Scenarios Concurrency=$Concurrency ImageSize=$ImageSize Video=${VideoResolution}/${VideoDurationSeconds}s AspectRatio=$VideoAspectRatio"
npm run load:sub2api-chain
