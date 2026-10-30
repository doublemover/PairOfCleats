param([string]$Executable, [string]$FixtureRoot)
$ErrorActionPreference = 'Stop'
$rootPath = [IO.Path]::GetFullPath($FixtureRoot)
$selectedPath = [IO.Path]::GetFullPath($Executable)
$relative = [IO.Path]::GetRelativePath($rootPath, $selectedPath)
if ($relative -eq '..' -or $relative.StartsWith('..' + [IO.Path]::DirectorySeparatorChar) -or [IO.Path]::IsPathRooted($relative)) { throw 'Native host requires its disposable executable copy' }
Add-Type -Path (Join-Path $PSScriptRoot '../windows/private-desktop.cs')
$desktop = [PairOfCleats.Tests.PrivateDesktop]::new()
$hostProcess = $null
$children = @{}
$primary = $null
$exitRecord = @{ pid = $null; exitCode = $null; children = @(); privateDesktop = $desktop.Name;
  originalDesktop = $desktop.OriginalDesktop; privateWindowObserved = $false; inputDesktopWindowObserved = $false; forcedTermination = $false }
try {
  $hostProcess = $desktop.Start($selectedPath, [string[]]@('--multiinstance', '--background', '--new-window'), (Get-Location).Path)
  $exitRecord.pid = $hostProcess.Id
  @{ pid = $hostProcess.Id; executable = $selectedPath; privateDesktop = $desktop.Name } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $rootPath 'host-process.json')
  $deadline = [DateTime]::UtcNow.AddSeconds(18)
  while (!$hostProcess.WaitForExit(100)) {
    if ($desktop.WindowProcessIds() -contains $hostProcess.Id) { $exitRecord.privateWindowObserved = $true }
    if ([PairOfCleats.Tests.PrivateDesktop]::HasWindowOnInputDesktop($hostProcess.Id)) {
      $exitRecord.inputDesktopWindowObserved = $true
      throw 'Native qualification window reached the input desktop'
    }
    foreach ($child in (Get-CimInstance Win32_Process -Filter "ParentProcessId = $($hostProcess.Id)")) {
      $children[[int]$child.ProcessId] = @{ pid = [int]$child.ProcessId; name = $child.Name; executable = $child.ExecutablePath }
    }
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Native editor exceeded its qualification deadline' }
  }
  if (!$exitRecord.privateWindowObserved) { throw 'Actual editor window was not observed on its private desktop' }
} catch { $primary = $_.Exception }
finally {
  try {
    if ($null -ne $hostProcess) {
      if (!$hostProcess.HasExited) {
        $exitRecord.forcedTermination = $true
        $hostProcess.Kill($true)
        if (!$hostProcess.WaitForExit(3000)) { throw 'Owned editor did not reap after termination' }
      }
      $exitRecord.exitCode = $hostProcess.ExitCode
    }
    $desktop.Dispose()
  } catch {
    if ($null -ne $primary) { $primary = [AggregateException]::new($primary, $_.Exception) } else { $primary = $_.Exception }
  }
  $exitRecord.children = @($children.Values)
  $exitRecord.privateHandleClosed = $desktop.PrivateHandleClosed
  $exitRecord | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $rootPath 'host-exit.json')
}
if ($null -ne $primary) { throw $primary }
