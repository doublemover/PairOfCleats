param(
  [string]$ListPath = 'TEST_PATHS.txt',
  [int]$TimeoutSeconds = 20,
  [string]$PassListPath = '',
  [Alias('Gen-Short')]
  [switch]$GenShort
)

if ($PSVersionTable.PSVersion.Major -lt 7) {
  Write-Error 'run-all-tests.ps1 requires PowerShell 7.'
  exit 1
}

$repoRoot = $PSScriptRoot
$listFullPath = if ([System.IO.Path]::IsPathRooted($ListPath)) { $ListPath } else { Join-Path $repoRoot $ListPath }
if (-not (Test-Path -LiteralPath $listFullPath)) {
  Write-Error "Test list not found: $listFullPath"
  exit 1
}

$passListFullPath = ''
if ($PassListPath) {
  $passListFullPath = if ([System.IO.Path]::IsPathRooted($PassListPath)) { $PassListPath } else { Join-Path $repoRoot $PassListPath }
  Remove-Item -LiteralPath $passListFullPath -ErrorAction SilentlyContinue
}

$skipList = @(
  'tests/api-server-stream.js'
)

$tests = Get-Content -Path $listFullPath | ForEach-Object { $_.Trim() } | Where-Object { $_ }
foreach ($raw in $tests) {
  $path = $raw
  if ($path.StartsWith('node ', [System.StringComparison]::OrdinalIgnoreCase)) {
    $path = $path.Substring(5).Trim()
  }
  if ($skipList -contains $path.Replace('\', '/')) {
    Write-Host "Skipping $path (blocked)."
    continue
  }
  $script = Join-Path $repoRoot 'run-test.ps1'
  if ($GenShort) {
    & $script -TestPath $path -TimeoutSeconds $TimeoutSeconds -GenShort
  } else {
    & $script -TestPath $path -TimeoutSeconds $TimeoutSeconds
  }
  if ($LASTEXITCODE -eq 0 -and $passListFullPath) {
    Add-Content -Path $passListFullPath -Value $path
  } elseif ($LASTEXITCODE -ne 0) {
    Write-Warning "Test failed or timed out: $path (exit $LASTEXITCODE)"
  }
}
