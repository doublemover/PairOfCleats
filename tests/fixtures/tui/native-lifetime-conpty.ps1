param([string]$Binary, [string]$FixtureRoot, [string]$Mode, [string]$Wrapper = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../windows/native-call.ps1')
$library = [Runtime.InteropServices.NativeLibrary]::Load('kernel32.dll')
$getHandle = New-PocNativeCall $library 'GetStdHandle' ([IntPtr]) @([int])
$getMode = New-PocNativeCall $library 'GetConsoleMode' ([int]) @([IntPtr], [IntPtr])
function Read-PocConsoleMode {
  param([int]$Which)
  $pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal(4)
  try {
    $handle = $getHandle.Invoke($null, @($Which))
    if ($getMode.Invoke($null, @($handle, $pointer)) -eq 0) {
      throw "GetConsoleMode failed for standard handle $Which"
    }
    return [uint32][Runtime.InteropServices.Marshal]::ReadInt32($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer)
  }
}
$beforeInput = Read-PocConsoleMode -10
$beforeOutput = Read-PocConsoleMode -11
$seedName = if ($Mode -eq 'validate-search') { 'seed-complete-build.json' }
  elseif ($Mode -in @('build-search', 'workspace')) { 'seed-partial-build.json' }
  else { $null }
if ($seedName) {
  # Initialize the independent console observer while the canonical seed builds.
  # Start the native lifetime only after the seed owner has actually completed.
  $seedDeadline = [DateTime]::UtcNow.AddSeconds(20)
  while (!(Test-Path -LiteralPath (Join-Path $FixtureRoot $seedName))) {
    if ([DateTime]::UtcNow -gt $seedDeadline) { throw 'Canonical workflow seed did not complete' }
    Start-Sleep -Milliseconds 20
  }
}
$native = [System.Diagnostics.Process]::new()
$native.StartInfo.FileName = $Binary
if ($Wrapper) { $native.StartInfo.ArgumentList.Add($Wrapper) }
$native.StartInfo.UseShellExecute = $false
$native.StartInfo.RedirectStandardOutput = $Mode -eq 'terminal-error'
$native.StartInfo.RedirectStandardError = $true
try {
  if (!$native.Start()) { throw 'Native binary did not start' }
  if ($Wrapper) {
    @{ wrapper = $native.Id } | ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $FixtureRoot 'pids.jsonl')
    $childrenDeadline = [DateTime]::UtcNow.AddSeconds(5)
    $nativeChild = $null
    while (!$nativeChild) {
      $nativeChild = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($native.Id)" | Where-Object Name -Like 'pairofcleats-tui*.exe' | Select-Object -First 1
      if ([DateTime]::UtcNow -gt $childrenDeadline -or $native.HasExited) { throw 'Wrapper did not start its native child' }
      if (!$nativeChild) { Start-Sleep -Milliseconds 20 }
    }
    @{ native = [int]$nativeChild.ProcessId; executablePath = $nativeChild.ExecutablePath } | ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $FixtureRoot 'pids.jsonl')
    $supervisor = $null
    while (!$supervisor) {
      $supervisor = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($nativeChild.ProcessId)" | Select-Object -First 1
      if ([DateTime]::UtcNow -gt $childrenDeadline -or $native.HasExited) { throw 'Native child did not start its supervisor' }
      if (!$supervisor) { Start-Sleep -Milliseconds 20 }
    }
    @{ supervisor = [int]$supervisor.ProcessId } | ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $FixtureRoot 'pids.jsonl')
  } else {
    @{ native = $native.Id } | ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $FixtureRoot 'pids.jsonl')
  }
  $stderr = $native.StandardError.ReadToEndAsync()
  if ($Mode -eq 'terminal-error') {
    $stdout = $native.StandardOutput.ReadToEndAsync()
    # Keep the real input console. Closing only the output pipe exercises the
    # native draw error and orderly cleanup; it does not terminate the process.
    $until = [DateTime]::UtcNow.AddSeconds(12)
    while (!(Test-Path -LiteralPath (Join-Path $FixtureRoot 'break-output'))) {
      if ($native.HasExited) { throw "Native process exited before transport failure: $($stderr.GetAwaiter().GetResult())" }
      if ([DateTime]::UtcNow -gt $until) { throw 'Transport failure witness timed out' }
      Start-Sleep -Milliseconds 20
    }
    $native.StandardOutput.Close()
  }
  if (!$native.WaitForExit(18000)) { throw 'Native process exceeded lifetime deadline' }
  $afterInput = Read-PocConsoleMode -10
  $afterOutput = Read-PocConsoleMode -11
  @{ mode = $Mode; exitCode = $native.ExitCode; stderr = $stderr.GetAwaiter().GetResult();
    beforeInput = $beforeInput; afterInput = $afterInput; beforeOutput = $beforeOutput; afterOutput = $afterOutput;
    terminalRestored = ($beforeInput -eq $afterInput -and $beforeOutput -eq $afterOutput)
  } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $FixtureRoot 'terminal-receipt.json')
} finally {
  if (!$native.HasExited) { $native.Kill($true); $native.WaitForExit() }
  $native.Dispose()
  [Runtime.InteropServices.NativeLibrary]::Free($library)
}
