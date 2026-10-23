<#
.SYNOPSIS
  Puts a demo computer back to "never installed HAI" between takes of demos/13-desktop-installer.md.

.DESCRIPTION
  Shows what it would do and changes nothing, unless both -Run and -ThisIsADemoMachine are given. It:
    - uninstalls HAI (the per-user installer's own uninstaller, with its own default of keeping nothing the user chose to keep:
      here the data folder is removed afterwards, because a fresh first run is the point);
    - deletes HAI's data folder (%APPDATA%\HAI);
    - signs Claude Code out with Claude Code's own `claude auth logout` (it never reads or deletes Claude's credential files);
    - removes the claude.exe the official installer put in %USERPROFILE%\.local\bin.
  Run twice, the second run finds nothing to do. It refuses to run on a computer with a git checkout of HAI's repository
  (a developer's computer), which is not a demo machine.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File demos\13-desktop-installer.ps1
  powershell -ExecutionPolicy Bypass -File demos\13-desktop-installer.ps1 -Run -ThisIsADemoMachine
#>
[CmdletBinding()]
param(
  [switch]$Run,
  [switch]$ThisIsADemoMachine
)

$ErrorActionPreference = 'Stop'
$doIt = $Run -and $ThisIsADemoMachine

if ($Run -and -not $ThisIsADemoMachine) {
  Write-Error 'Add -ThisIsADemoMachine to confirm this computer is a clean demo machine, not your own.'
  exit 2
}

# A developer's computer is not a demo machine.
$repoRoot = Split-Path -Parent $PSScriptRoot
if ($doIt -and (Test-Path -LiteralPath (Join-Path $repoRoot 'pnpm-workspace.yaml'))) {
  Write-Error "This is run from a checkout of the HAI repository ($repoRoot). Copy the script to the demo machine and run it there."
  exit 2
}

$programs = Join-Path $env:LOCALAPPDATA 'Programs\HAI'
$dataDir = Join-Path $env:APPDATA 'HAI'
$claudeExe = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
$uninstaller = Join-Path $programs 'Uninstall HAI.exe'

function Step([string]$what, [bool]$needed, [scriptblock]$action) {
  if (-not $needed) { Write-Host "nothing to do: $what"; return }
  if (-not $doIt) { Write-Host "would: $what"; return }
  Write-Host "doing: $what"
  & $action
}

Get-Process -Name 'HAI' -ErrorAction SilentlyContinue | ForEach-Object {
  Step "stop the running HAI (process $($_.Id))" $true { Stop-Process -Id $_.Id -Force }
}

Step 'uninstall HAI' (Test-Path -LiteralPath $uninstaller) {
  Start-Process -FilePath $uninstaller -ArgumentList '/currentuser', '/S' -Wait
  # The uninstaller hands over to a copy of itself and returns at once: wait for the folder to go.
  for ($i = 0; $i -lt 60 -and (Test-Path -LiteralPath $programs); $i++) { Start-Sleep -Milliseconds 500 }
}

Step "delete HAI's data folder ($dataDir)" (Test-Path -LiteralPath $dataDir) {
  Remove-Item -LiteralPath $dataDir -Recurse -Force
}

$claude = Get-Command claude -ErrorAction SilentlyContinue
Step 'sign Claude Code out (claude auth logout)' ($null -ne $claude) {
  & $claude.Source auth logout | Out-Null
}

Step "remove Claude Code ($claudeExe)" (Test-Path -LiteralPath $claudeExe) {
  Remove-Item -LiteralPath $claudeExe -Force
}

if (-not $doIt) { Write-Host "`nThis was a preview. Nothing was changed." }
else { Write-Host "`nDone. The computer is ready for a first run." }
