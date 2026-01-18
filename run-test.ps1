param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$TestPath,
  [string[]]$Args = @(),
  [int]$TimeoutSeconds = 10
)

if ($PSVersionTable.PSVersion.Major -lt 7) {
  Write-Error 'run-test.ps1 requires PowerShell 7.'
  exit 1
}

$repoRoot = $PSScriptRoot
$testFullPath = if ([System.IO.Path]::IsPathRooted($TestPath)) {
  $TestPath
} else {
  Join-Path $repoRoot $TestPath
}

if (-not (Test-Path -LiteralPath $testFullPath)) {
  Write-Error "Test not found: $testFullPath"
  exit 1
}

$testFullPath = (Resolve-Path -LiteralPath $testFullPath).Path
$relativePath = $testFullPath
if ($testFullPath.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  $relativePath = $testFullPath.Substring($repoRoot.Length).TrimStart('\', '/')
}
$tick = [char]96

$timesPath = Join-Path $repoRoot 'TEST_TIMES.md'
$slowPath = Join-Path $repoRoot 'SLOW_TESTS.md'

$ensureTemplate = {
  if (-not (Test-Path -LiteralPath $timesPath)) {
    $template = @(
      '# Test Times',
      '',
      '## Setup Checklist',
      '- [x] Write a little helper .ps1 (powershell 7) script that allows you to run a single test in your worktree without messing anything up',
      '  - [x] This helper script will add a line to TEST_TIMES.md containing the path/filename of the test if it does not exist already, and then log how long it took to run that test',
      '  - [x] Use this helper every time we have to run a test for this work, if a test takes longer than 10 seconds while you are doing this, cancel that specific test or end that specific process if you''re absolutely sure you have to, and then add that test''s path/filename to a SLOW_TESTS.md list',
      '',
      '## Tracked Tests',
      '<!-- TESTS:START -->',
      '<!-- TESTS:END -->',
      '',
      '## Runs',
      '<!-- RUNS:START -->',
      '<!-- RUNS:END -->'
    )
    Set-Content -Path $timesPath -Value $template
  }
}

& $ensureTemplate

$lines = Get-Content -Path $timesPath
$testLine = "- $tick$relativePath$tick"
$testStart = [Array]::IndexOf($lines, '<!-- TESTS:START -->')
$testEnd = [Array]::IndexOf($lines, '<!-- TESTS:END -->')
if ($testStart -ge 0 -and $testEnd -gt $testStart) {
  $existing = $lines[($testStart + 1)..($testEnd - 1)] | Where-Object { $_ -eq $testLine }
  if (-not $existing) {
    $before = $lines[0..$testStart]
    $after = $lines[$testEnd..($lines.Length - 1)]
    $lines = @($before + $testLine + $after)
  }
}

Set-Content -Path $timesPath -Value $lines

$start = Get-Date
$argList = @($testFullPath) + $Args
$process = Start-Process -FilePath 'node' -ArgumentList $argList -WorkingDirectory $repoRoot -NoNewWindow -PassThru
if (-not $process) {
  Write-Error 'Failed to start test process.'
  exit 1
}
$completed = $process.WaitForExit([Math]::Max(1, $TimeoutSeconds) * 1000)
$timedOut = -not $completed
if ($timedOut) {
  Stop-Process -Id $process.Id -Force
}
$end = Get-Date
$elapsed = $end - $start
$durationSeconds = [Math]::Round($elapsed.TotalSeconds, 2)
$timestamp = $end.ToString('yyyy-MM-dd HH:mm:ss')
$exitLabel = if ($timedOut) { 'timeout' } else { "exit $($process.ExitCode)" }
$runLine = "- $timestamp | $tick$relativePath$tick | ${durationSeconds}s | $exitLabel"

$lines = Get-Content -Path $timesPath
$runStart = [Array]::IndexOf($lines, '<!-- RUNS:START -->')
$runEnd = [Array]::IndexOf($lines, '<!-- RUNS:END -->')
if ($runStart -ge 0 -and $runEnd -gt $runStart) {
  $before = $lines[0..$runStart]
  $after = $lines[$runEnd..($lines.Length - 1)]
  $lines = @($before + $runLine + $after)
}
Set-Content -Path $timesPath -Value $lines

if ($timedOut -or $elapsed.TotalSeconds -gt 10) {
  if (-not (Test-Path -LiteralPath $slowPath)) {
    Set-Content -Path $slowPath -Value @('# Slow Tests', '')
  }
  $slowLines = Get-Content -Path $slowPath
  if (-not ($slowLines | Where-Object { $_ -eq $testLine })) {
    Add-Content -Path $slowPath -Value $testLine
  }
}

if ($timedOut) {
  Write-Error "Test exceeded ${TimeoutSeconds}s and was stopped."
  exit 1
}

exit $process.ExitCode
