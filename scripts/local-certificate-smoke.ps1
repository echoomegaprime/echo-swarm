param(
  [Parameter(Mandatory = $true)][string]$VerificationUrl,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{40,64}$')][string]$ReleaseSha,
  [int]$Port = 18080,
  [ValidateRange(0, 60)][int]$HoldSeconds = 0
)

$ErrorActionPreference = 'Stop'
$repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$testDir = Join-Path $tempRoot ('echo-cert-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$key = Join-Path $testDir 'builder.pem'
$stdout = Join-Path $testDir 'vite.out.log'
$stderr = Join-Path $testDir 'vite.err.log'
$origin = "http://127.0.0.1:$Port"
$proc = $null

try {
  & openssl genpkey -algorithm ED25519 -out $key 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'openssl key generation failed' }

  $env:ECHO_SWARM_EDITION = 'private-oauth'
  $env:VITE_ECHO_SWARM_EDITION = 'private-oauth'
  $env:VITE_AUTH_ENABLED = 'false'
  $env:ECHO_RELEASE_SHA = $ReleaseSha
  $env:ECHO_CERTFORGE_VERIFICATION_URL = $VerificationUrl
  $env:ECHO_BUILDER_SIGNING_KEY_FILE = $key
  $env:ECHO_COMMANDER_DISPLAY_NAME = 'Bobby Don McWilliams II'

  $proc = Start-Process -FilePath (Get-Command node).Source `
    -ArgumentList @('node_modules/vite/bin/vite.js', 'dev', '--host', '127.0.0.1', '--port', "$Port", '--strictPort') `
    -WorkingDirectory $repo -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr

  $ready = $false
  for ($i = 0; $i -lt 60; $i += 1) {
    try {
      $null = Invoke-WebRequest -Uri "$origin/api/certificate" -UseBasicParsing -TimeoutSec 2
      $ready = $true
      break
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $ready) {
    Get-Content $stderr -Tail 80
    throw 'local certificate server did not start'
  }

  $cert = Invoke-RestMethod -Uri "$origin/api/certificate"
  [pscustomobject]@{
    status = $cert.status
    complete = $cert.complete
    edition = $cert.edition
    release_sha = $cert.releaseSha
    digest_len = $cert.certificateDigest.Length
    builder = $cert.signatures.builder.verified
    certifier = $cert.signatures.certifier.verified
    commander = ($cert.signatures.commander.verified -eq $true)
  } | ConvertTo-Json -Compress

  $svg = (Invoke-WebRequest -Uri "$origin/api/certificate.svg" -UseBasicParsing).Content
  [pscustomobject]@{
    svg_bytes = $svg.Length
    title = ($svg -match 'Certificate of Certified Release')
    builder = ($svg -match 'AI BUILDER')
    certifier = ($svg -match 'AI CERTIFIER')
    commander = ($svg -match 'COMMANDER')
  } | ConvertTo-Json -Compress

  $body = @{ jsonrpc = '2.0'; id = 1; method = 'tools/list'; params = @{} } | ConvertTo-Json -Depth 4
  $mcp = Invoke-RestMethod -Uri "$origin/api/plugin/mcp" -Method Post `
    -Headers @{ 'x-echo-agent' = 'acceptance-test' } -ContentType 'application/json' -Body $body
  $names = @($mcp.result.tools.name)
  [pscustomobject]@{
    tools = $names.Count
    certificate_status = ($names -contains 'swarm_certificate_status')
    certificate_artifact = ($names -contains 'swarm_certificate_artifact')
  } | ConvertTo-Json -Compress

  if ($HoldSeconds -gt 0) {
    [pscustomobject]@{ preview = "$origin/certificate"; hold_seconds = $HoldSeconds } |
      ConvertTo-Json -Compress
    Start-Sleep -Seconds $HoldSeconds
  }
} finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    $proc.WaitForExit(5000) | Out-Null
  }
  $resolved = [System.IO.Path]::GetFullPath($testDir)
  if ($resolved.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
  }
}
