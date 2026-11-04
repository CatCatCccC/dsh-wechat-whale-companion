# Pack companion + install into remote dsh-harness (Docker).
# Usage:
#   .\deploy.ps1
#   .\deploy.ps1 -HostName 106.75.251.51 -Container dsh-harness
#   .\deploy.ps1 -SkipRestart

param(
  [string]$HostName = '106.75.251.51',
  [string]$SshUser = 'root',
  [string]$IdentityFile = '',
  [string]$Container = 'dsh-harness',
  [string]$Profile = 'web',
  [switch]$SkipRestart,
  [switch]$SkipTest
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not $IdentityFile) {
  $candidate = Join-Path $env:USERPROFILE '.ssh\langbot_deploy'
  if (Test-Path $candidate) { $IdentityFile = $candidate }
}
if (-not $IdentityFile -or -not (Test-Path $IdentityFile)) {
  throw "SSH key missing. Pass -IdentityFile or put ~/.ssh/langbot_deploy"
}

$sshOpts = @('-i', $IdentityFile, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes')
$pkg = Get-Content -Raw package.json | ConvertFrom-Json
$version = [string]$pkg.version
$name = [string]$pkg.name
$tgzName = "$name-$version.tgz"
$remoteTgz = "/tmp/$tgzName"
$remote = "${SshUser}@${HostName}"

if (-not $SkipTest) {
  Write-Host "==> npm test"
  npm test
  if ($LASTEXITCODE -ne 0) { throw "npm test failed ($LASTEXITCODE)" }
}

Write-Host "==> npm pack ($tgzName)"
Remove-Item -ErrorAction SilentlyContinue *.tgz
npm pack --pack-destination $PSScriptRoot
if ($LASTEXITCODE -ne 0) { throw "npm pack failed ($LASTEXITCODE)" }
if (-not (Test-Path $tgzName)) { throw "missing $tgzName after pack" }

Write-Host "==> scp $tgzName -> ${remote}:$remoteTgz (key=$IdentityFile)"
& scp @sshOpts $tgzName "${remote}:$remoteTgz"
if ($LASTEXITCODE -ne 0) { throw "scp failed ($LASTEXITCODE)" }

$install = @"
set -e
docker cp '$remoteTgz' '$Container':'$remoteTgz'
docker exec '$Container' dsh plugin --profile '$Profile' add 'file:$remoteTgz'
"@
if (-not $SkipRestart) {
  $install += "`ndocker restart '$Container'`n"
}

Write-Host "==> remote install (file:$remoteTgz) in $Container"
& ssh @sshOpts $remote $install
if ($LASTEXITCODE -ne 0) { throw "remote install failed ($LASTEXITCODE)" }

Write-Host "==> done $name@$version on $HostName ($Container)"
Write-Host "    health: ssh -L 3199:127.0.0.1:3199 $remote  then  http://127.0.0.1:3199/physical"
