param([string]$Executable, [string]$Project, [string]$FixtureRoot)
$ErrorActionPreference = 'Stop'
$rootPath = [IO.Path]::GetFullPath($FixtureRoot)
$selectedPath = [IO.Path]::GetFullPath($Executable)
$relative = [IO.Path]::GetRelativePath($rootPath, $selectedPath)
if ($relative -eq '..' -or $relative.StartsWith('..' + [IO.Path]::DirectorySeparatorChar) -or [IO.Path]::IsPathRooted($relative)) { throw 'Native host requires its disposable executable copy' }
$hostProcess = Start-Process -FilePath $selectedPath -ArgumentList @('--multiinstance', '--background', '--new-window', '--project', ('"' + $Project + '"')) -WindowStyle Hidden -PassThru
$children = @{}
try {
  @{ pid = $hostProcess.Id; executable = $selectedPath } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $rootPath 'host-process.json')
  $deadline = [DateTime]::UtcNow.AddSeconds(26)
  while (!$hostProcess.WaitForExit(100)) {
    foreach ($child in (Get-CimInstance Win32_Process -Filter "ParentProcessId = $($hostProcess.Id)")) {
      $children[[int]$child.ProcessId] = @{ pid = [int]$child.ProcessId; name = $child.Name; executable = $child.ExecutablePath }
    }
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Native editor exceeded its qualification deadline' }
  }
  @{ pid = $hostProcess.Id; exitCode = $hostProcess.ExitCode; children = @($children.Values) } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $rootPath 'host-exit.json')
} finally {
  if (!$hostProcess.HasExited) { $hostProcess.Kill($true); $hostProcess.WaitForExit() }
  $hostProcess.Dispose()
}
