param([string]$FixtureRoot)
$ErrorActionPreference = 'Stop'
$rootPath = [IO.Path]::GetFullPath($FixtureRoot)
if (!(Test-Path -LiteralPath $rootPath -PathType Container)) { throw 'A disposable fixture directory is required' }
Add-Type -Path (Join-Path $PSScriptRoot '../../helpers/windows/private-desktop.cs')
$desktop = [PairOfCleats.Tests.PrivateDesktop]::new()
$observations = @()
$primary = $null
try {
  foreach ($mode in @('observe', 'window')) {
    $child = $desktop.Start((Get-Process -Id $PID).Path,
      [string[]]@('-NoLogo', '-NoProfile', '-NonInteractive', '-File', (Join-Path $PSScriptRoot 'private-desktop-child.ps1'), $rootPath, $desktop.Name, $mode),
      (Get-Location).Path)
    $ready = Join-Path $rootPath ($mode + '-ready.json')
    $deadline = [DateTime]::UtcNow.AddSeconds(6)
    while (!(Test-Path -LiteralPath $ready)) {
      if ($child.HasExited -or [DateTime]::UtcNow -gt $deadline) { throw ('Isolated ' + $mode + ' child failed before readiness') }
      Start-Sleep -Milliseconds 20
    }
    $observation = Get-Content -LiteralPath $ready -Raw | ConvertFrom-Json
    if ($observation.pid -ne $child.Id -or $observation.desktop -ne $desktop.Name) { throw 'Native child identity mismatch' }
    if ($mode -eq 'window') {
      if (!$observation.visibleWindow -or $desktop.WindowProcessIds() -notcontains $child.Id) { throw 'Actual private test window was not observed' }
      if ([PairOfCleats.Tests.PrivateDesktop]::HasWindowOnInputDesktop($child.Id)) { throw 'Owned window reached the input desktop' }
      [IO.File]::WriteAllText((Join-Path $rootPath 'release-window'), 'release')
    }
    if (!$child.WaitForExit(6000) -or $child.ExitCode -ne 0) { throw ('Isolated ' + $mode + ' child did not exit successfully') }
    $observations += @{ mode = $mode; pid = $child.Id; exitCode = $child.ExitCode; desktop = $observation.desktop;
      inputDesktop = $observation.inputDesktop; actualVisibleFlag = $observation.visibleWindow; reaped = $true }
  }
  $receipt = @{ station = $desktop.Station; originalDesktop = $desktop.OriginalDesktop; privateDesktop = $desktop.Name;
    originalThreadRestored = $desktop.OriginalThreadRestored; observations = $observations }
} catch { $primary = $_.Exception }
finally {
  try { $desktop.Dispose() } catch { if ($null -ne $primary) { throw [AggregateException]::new($primary, $_.Exception) }; throw }
}
if ($null -ne $primary) { throw $primary }
$receipt.privateHandleClosed = $desktop.PrivateHandleClosed
$receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $rootPath 'qualification-receipt.json')
$receipt | ConvertTo-Json -Depth 6 -Compress
