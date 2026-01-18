param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$TestPath,
  [string[]]$Args = @(),
  [int]$TimeoutSeconds = 20,
  [Alias('Gen-Short')]
  [switch]$GenShort
)

if ($PSVersionTable.PSVersion.Major -lt 7) {
  Write-Error 'run-test.ps1 requires PowerShell 7.'
  exit 1
}

$scriptRoot = $PSScriptRoot
$repoRoot = Split-Path $scriptRoot -Parent
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

$timesDir = Join-Path $scriptRoot 'test_times'
$timesPath = Join-Path $timesDir 'TEST_TIMES.md'
$slowPath = Join-Path $timesDir 'SLOW_TESTS.md'
$shortPath = Join-Path $timesDir 'SHORT_TESTS.md'
$null = New-Item -ItemType Directory -Path $timesDir -Force

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

if ($GenShort) {
  $TimeoutSeconds = 1
}

$lines = Get-Content -Path $timesPath
$testLine = "- $tick$relativePath$tick"
$testStart = [Array]::IndexOf($lines, '<!-- TESTS:START -->')
$testEnd = [Array]::IndexOf($lines, '<!-- TESTS:END -->')
if ($testStart -lt 0 -or $testEnd -lt 0) {
  Add-Content -Path $timesPath -Value @(
    '',
    '## Tracked Tests',
    '<!-- TESTS:START -->',
    '<!-- TESTS:END -->'
  )
  $lines = Get-Content -Path $timesPath
  $testStart = [Array]::IndexOf($lines, '<!-- TESTS:START -->')
  $testEnd = [Array]::IndexOf($lines, '<!-- TESTS:END -->')
}
if ($testStart -ge 0 -and $testEnd -gt $testStart) {
  $existing = @()
  if ($testEnd - $testStart -gt 1) {
    $existing = $lines[($testStart + 1)..($testEnd - 1)] | Where-Object { $_ -eq $testLine }
  }
  if (-not $existing) {
    $before = $lines[0..$testStart]
    $after = $lines[$testEnd..($lines.Length - 1)]
    $lines = @($before + $testLine + $after)
    Set-Content -Path $timesPath -Value $lines
  }
}

$start = Get-Date
$argList = @($testFullPath) + $Args
$errorPath = Join-Path $timesDir 'TEST_ERRORS.md'
$stderrPath = Join-Path $env:TEMP ("poc-test-stderr-{0}.log" -f ([guid]::NewGuid().ToString('N')))
$process = Start-Process -FilePath 'node' -ArgumentList $argList -WorkingDirectory $repoRoot -NoNewWindow -PassThru -RedirectStandardError $stderrPath
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
if ($runStart -lt 0 -or $runEnd -lt 0) {
  Add-Content -Path $timesPath -Value @(
    '',
    '## Runs',
    '<!-- RUNS:START -->',
    '<!-- RUNS:END -->'
  )
  $lines = Get-Content -Path $timesPath
  $runStart = [Array]::IndexOf($lines, '<!-- RUNS:START -->')
  $runEnd = [Array]::IndexOf($lines, '<!-- RUNS:END -->')
}
if ($runStart -ge 0 -and $runEnd -gt $runStart) {
  $runs = @()
  if ($runEnd - $runStart -gt 1) {
    $runs = $lines[($runStart + 1)..($runEnd - 1)]
  }
  $runs += $runLine
  $before = $lines[0..$runStart]
  $after = $lines[$runEnd..($lines.Length - 1)]
  $lines = @($before + $runs + $after)
  Set-Content -Path $timesPath -Value $lines
}

if (-not $GenShort -and ($timedOut -or $elapsed.TotalSeconds -gt $TimeoutSeconds)) {
  if (-not (Test-Path -LiteralPath $slowPath)) {
    Set-Content -Path $slowPath -Value @('# Slow Tests', '')
  }
  $slowLines = Get-Content -Path $slowPath
  if (-not ($slowLines | Where-Object { $_ -eq $testLine })) {
    Add-Content -Path $slowPath -Value $testLine
  }
}

if (-not $timedOut -and $process.ExitCode -ne 0) {
  if (-not (Test-Path -LiteralPath $errorPath)) {
    Set-Content -Path $errorPath -Value @('# Test Errors', '')
  }
  $errorDetail = ''
  if (Test-Path -LiteralPath $stderrPath) {
    $errorDetail = (Get-Content -Path $stderrPath -Tail 8) -join ' | '
    $errorDetail = $errorDetail.Trim()
  }
  if (-not $errorDetail) {
    $errorDetail = if ($timedOut) { 'timeout' } else { 'no stderr output' }
  }
  $errorLine = "- $timestamp | $tick$relativePath$tick | ${durationSeconds}s | $exitLabel | reason: $errorDetail"
  Add-Content -Path $errorPath -Value $errorLine
}

if ($timedOut) {
  Write-Warning "Test exceeded ${TimeoutSeconds}s and was stopped (${durationSeconds}s)."
  exit 1
}
Write-Host "Test completed in ${durationSeconds}s ($exitLabel)."
if ($GenShort -and $process.ExitCode -eq 0 -and $elapsed.TotalSeconds -le 1) {
  if (-not (Test-Path -LiteralPath $shortPath)) {
    Set-Content -Path $shortPath -Value @('# Short Tests', '')
  }
  $shortLines = Get-Content -Path $shortPath
  if (-not ($shortLines | Where-Object { $_ -eq $testLine })) {
    Add-Content -Path $shortPath -Value $testLine
  }
}
if (Test-Path -LiteralPath $stderrPath) {
  Remove-Item -LiteralPath $stderrPath -Force
}
exit $process.ExitCode
