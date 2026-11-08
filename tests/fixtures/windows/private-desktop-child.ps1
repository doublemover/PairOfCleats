param([string]$FixtureRoot, [string]$ExpectedDesktop, [ValidateSet('observe', 'window')][string]$Mode = 'observe')
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot '../../helpers/windows/private-desktop.cs')
$window = [IntPtr]::Zero
try {
  $actual = [PairOfCleats.Tests.PrivateDesktop]::CurrentThreadDesktop
  $inputName = [PairOfCleats.Tests.PrivateDesktop]::InputDesktop
  if ($actual -ne $ExpectedDesktop -or $actual -eq $inputName) { throw 'Child isolation not confirmed; no window created' }
  if ($Mode -eq 'window') { $window = [PairOfCleats.Tests.PrivateDesktop]::CreateVisibleTestWindow($ExpectedDesktop) }
  @{ pid = $PID; desktop = $actual; inputDesktop = $inputName; mode = $Mode;
    visibleWindow = $window -ne [IntPtr]::Zero -and [PairOfCleats.Tests.PrivateDesktop]::TestWindowIsVisible($window) } |
    ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $FixtureRoot ($Mode + '-ready.json'))
  if ($Mode -eq 'window') {
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while (!(Test-Path -LiteralPath (Join-Path $FixtureRoot 'release-window'))) {
      if ([DateTime]::UtcNow -gt $deadline) { throw 'Private test window exceeded its deadline' }
      Start-Sleep -Milliseconds 20
    }
  }
} catch {
  $_.ToString() | Set-Content -LiteralPath (Join-Path $FixtureRoot ($Mode + '-error.txt'))
  throw
} finally {
  if ($window -ne [IntPtr]::Zero) { [PairOfCleats.Tests.PrivateDesktop]::DestroyTestWindow($window) }
}
