[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')]
  [string]$ProjectId,

  [string]$Config = 'wrangler.jsonc',
  [string]$InfisicalDomain = 'http://localhost/api',
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ([System.IO.Path]::IsPathRooted($Config)) {
  $configPath = [System.IO.Path]::GetFullPath($Config)
} else {
  $configPath = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $Config))
}
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw '找不到目标 Wrangler 配置文件。'
}

$configText = Get-Content -LiteralPath $configPath -Raw
$workerMatch = [regex]::Match($configText, '(?m)^\s*"name"\s*:\s*"([^"]+)"')
if (-not $workerMatch.Success) {
  throw '无法从目标 Wrangler 配置读取 Worker 名称。'
}
$workerName = $workerMatch.Groups[1].Value
if ($workerName -eq 'video-template') {
  throw '目标仍是模板占位 Worker；先配置当前站点的 wrangler.jsonc。'
}
$environmentMatch = [regex]::Match($configText, '(?m)^\s*"APP_ENV"\s*:\s*"([^"]+)"')
$applicationEnvironment = if ($environmentMatch.Success) { $environmentMatch.Groups[1].Value } else { 'unknown' }
if ($Apply -and $applicationEnvironment -notin @('production', 'staging')) {
  throw 'Apply 仅允许 production 或 staging 配置；请先核对 APP_ENV。'
}

$wranglerScript = Join-Path $projectRoot 'node_modules/wrangler/bin/wrangler.js'
if (-not (Test-Path -LiteralPath $wranglerScript -PathType Leaf)) {
  throw '找不到项目本地 Wrangler；请先在当前站点安装项目依赖。'
}
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw '找不到 Node.js。'
}
$infisicalPath = $null
$infisicalCommand = Get-Command infisical.cmd -ErrorAction SilentlyContinue
if ($infisicalCommand) {
  $infisicalPath = $infisicalCommand.Source
}
if (-not $infisicalPath -and $env:APPDATA) {
  $infisicalCandidate = Join-Path $env:APPDATA 'npm/infisical.cmd'
  if (Test-Path -LiteralPath $infisicalCandidate -PathType Leaf) {
    $infisicalPath = $infisicalCandidate
  }
}
if (-not $infisicalPath) {
  $infisicalCommand = Get-Command infisical.exe -ErrorAction SilentlyContinue
  if ($infisicalCommand) {
    $infisicalPath = $infisicalCommand.Source
  }
}
if (-not $infisicalPath) {
  throw '找不到 Infisical CLI；请先安装并登录本机 Infisical。'
}

$secretLines = @()
$secret = $null
$payload = $null
try {
  $infisicalArguments = @(
    'secrets', 'get', 'GOOGLE_SHARED_CLIENT_SECRET',
    '--domain', $InfisicalDomain,
    '--projectId', $ProjectId,
    '--env', 'dev',
    '--path', '/projects/gamewebs/shared-core',
    '--plain', '--silent', '--log-level', 'error'
  )
  $secretLines = @(& $infisicalPath @infisicalArguments 2>$null)
  $infisicalExitCode = $LASTEXITCODE
  if ($infisicalExitCode -ne 0 -or $secretLines.Count -ne 1) {
    throw 'Infisical 未能返回唯一的共享客户端密钥。请检查登录、项目和变量名。'
  }

  $secret = [string]$secretLines[0]
  $secret = $secret.TrimEnd([char[]]@([char]13, [char]10))
  if ([string]::IsNullOrWhiteSpace($secret) -or $secret.Contains([string][char]13) -or $secret.Contains([string][char]10)) {
    throw 'Infisical 返回的共享客户端密钥为空或格式不正确。'
  }

  Write-Host "来源：Infisical /projects/gamewebs/shared-core / GOOGLE_SHARED_CLIENT_SECRET"
  Write-Host "目标：Worker $workerName（APP_ENV=$applicationEnvironment；$configPath）"
  if (-not $Apply) {
    Write-Host '仅完成读取和预览，没有修改 Cloudflare。确认目标后再加 -Apply。'
    return
  }

  $payload = @{ GOOGLE_CLIENT_SECRET = $secret } | ConvertTo-Json -Compress
  Push-Location $projectRoot
  try {
    $null = $payload | & $nodeCommand.Source $wranglerScript secret bulk -c $configPath 2>&1
    $wranglerExitCode = $LASTEXITCODE
    if ($wranglerExitCode -ne 0) {
      throw 'Wrangler 写入失败。请检查 Cloudflare 登录、Worker 权限和目标配置；未显示底层输出。'
    }
  } finally {
    Pop-Location
  }
  Write-Host 'Cloudflare Worker Secret 已提交。请核对最新部署，并完成一次真实 Google 登录回调。'
} finally {
  $secret = $null
  $payload = $null
  $secretLines = $null
}
