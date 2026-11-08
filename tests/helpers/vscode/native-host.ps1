param([string]$FixtureRoot)
$ErrorActionPreference = 'Stop'
$rootPath = [IO.Path]::GetFullPath($FixtureRoot)
$launch = Get-Content -LiteralPath (Join-Path $rootPath 'launch.json') -Raw | ConvertFrom-Json
$executable = [IO.Path]::GetFullPath($launch.executable)
$signature = Get-AuthenticodeSignature -LiteralPath $executable
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
  throw 'Native VS Code qualification requires the verified Microsoft executable'
}
Add-Type -Path (Join-Path $PSScriptRoot '../windows/private-desktop.cs')
$desktop = [PairOfCleats.Tests.PrivateDesktop]::new()
$hostProcess = $null
$children = @{}
$childNames = @{}
$childBirths = @{}
$primary = $null
$receipt = @{ privateDesktop = $desktop.Name; originalDesktop = $desktop.OriginalDesktop;
  privateWindowObserved = $false; inputDesktopWindowObserved = $false; forcedTermination = $false }
try {
  $hostProcess = $desktop.Start($executable, [string[]]$launch.arguments, (Get-Location).Path)
  $rootBirth = $hostProcess.StartTime.ToUniversalTime()
  $receipt.pid = $hostProcess.Id
  $deadline = [DateTime]::UtcNow.AddSeconds(18)
  while (!$hostProcess.WaitForExit(100)) {
    $observed = @(Get-CimInstance -Query 'SELECT ProcessId, ParentProcessId, Name, CreationDate FROM Win32_Process')
    $changed = $true
    while ($changed) {
      $changed = $false
      foreach ($child in $observed) {
        $childId = [int]$child.ProcessId
        if ($childId -eq $hostProcess.Id -or $children.ContainsKey($childId)) { continue }
        $taskParentProcess = $null
        $taskParentBirth = $null
        if ($child.ParentProcessId -eq $hostProcess.Id) { $taskParentProcess = $hostProcess; $taskParentBirth = $rootBirth }
        elseif ($children.ContainsKey([int]$child.ParentProcessId)) {
          $taskParentProcess = $children[[int]$child.ParentProcessId]
          $taskParentBirth = $childBirths[[int]$child.ParentProcessId]
        }
        if ($null -ne $taskParentProcess) {
          $created = $child.CreationDate.ToUniversalTime()
          if ($null -eq $taskParentBirth) { throw 'Original parent creation time is unavailable' }
          if ($created -lt $taskParentBirth -or ($taskParentProcess.HasExited -and $created -gt $taskParentProcess.ExitTime.ToUniversalTime())) { continue }
          try { $captured = Get-Process -Id $childId -ErrorAction Stop; $null = $captured.Handle }
          catch { continue }
          if ([Math]::Abs(($captured.StartTime.ToUniversalTime() - $created).TotalMilliseconds) -gt 1) { $captured.Dispose(); continue }
          $children[$childId] = $captured
          $childNames[$childId] = $captured.ProcessName
          $childBirths[$childId] = $created
          $changed = $true
        }
      }
    }
    if ($hostProcess.HasExited) { break }
    try { $windows = @($desktop.WindowProcessIds()) }
    catch {
      if (!$hostProcess.HasExited) { throw }
      # End observation at this original process's confirmed native exit. Do
      # not interpret a window enumeration racing teardown as an empty desktop.
      $receipt.finalWindowObservation = @{ state = 'host-exited-during-enumeration'; error = $_.Exception.ToString() }
      break
    }
    foreach ($ownedId in @($hostProcess.Id) + @($children.Keys)) {
      $original = if ($ownedId -eq $hostProcess.Id) { $hostProcess } else { $children[$ownedId] }
      if ($original.HasExited) { continue }
      if ($windows -contains $ownedId) { $receipt.privateWindowObserved = $true }
      if ([PairOfCleats.Tests.PrivateDesktop]::HasWindowOnInputDesktop($ownedId)) {
        $receipt.inputDesktopWindowObserved = $true
        throw 'Owned VS Code window reached the input desktop'
      }
    }
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Native VS Code exceeded its 18-second lifetime deadline' }
  }
  $receipt.exitCode = $hostProcess.ExitCode
  if (!$receipt.privateWindowObserved) { throw 'Actual VS Code window was not observed on its private desktop' }
  if ($hostProcess.ExitCode -ne 0) { throw 'Native VS Code extension qualification failed' }
  $settlementDeadline = [DateTime]::UtcNow.AddSeconds(3)
  foreach ($child in $children.Values) {
    $remaining = [Math]::Max(0, [int]($settlementDeadline - [DateTime]::UtcNow).TotalMilliseconds)
    if (!$child.WaitForExit($remaining)) { throw 'Original VS Code descendant did not exit naturally' }
  }
} catch { $primary = $_.Exception }
finally {
  try {
    if ($null -ne $hostProcess -and !$hostProcess.HasExited) {
      $receipt.forcedTermination = $true
      $hostProcess.Kill($true)
      if (!$hostProcess.WaitForExit(3000)) { throw 'Original VS Code process remains live' }
    }
    foreach ($child in $children.Values) {
      if (!$child.HasExited) {
        $receipt.forcedTermination = $true
        $child.Kill($true)
        if (!$child.WaitForExit(3000)) { throw 'Original VS Code descendant remains live' }
      }
    }
    $receipt.children = @($children.GetEnumerator() | ForEach-Object { @{ pid = $_.Key; name = $childNames[$_.Key]; exited = $_.Value.HasExited } })
    $receipt.resourcesReaped = $true
    $desktop.Dispose()
    $receipt.privateHandleClosed = $desktop.PrivateHandleClosed
    $receipt.originalThreadRestored = $desktop.OriginalThreadRestored
  } catch {
    if ($null -eq $primary) { $primary = $_.Exception }
    else { $primary = [AggregateException]::new($primary, $_.Exception) }
  }
  $receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $rootPath 'host-receipt.json')
  foreach ($child in $children.Values) { $child.Dispose() }
}
if ($null -ne $primary) { throw $primary }
$receipt | ConvertTo-Json -Depth 6 -Compress
