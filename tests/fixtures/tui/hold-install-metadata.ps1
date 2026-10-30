param([string]$MetadataPath, [string]$FixtureRoot)
$ErrorActionPreference = 'Stop'
$rootPath = [IO.Path]::GetFullPath($FixtureRoot)
$selectedPath = [IO.Path]::GetFullPath($MetadataPath)
$relative = [IO.Path]::GetRelativePath($rootPath, $selectedPath)
if ($relative -eq '..' -or $relative.StartsWith('..' + [IO.Path]::DirectorySeparatorChar) -or [IO.Path]::IsPathRooted($relative)) { throw 'Metadata holder requires its disposable fixture root' }
$handle = [IO.FileStream]::new($selectedPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
  [IO.File]::WriteAllText((Join-Path $rootPath 'metadata-held'), 'ready')
  $deadline = [DateTime]::UtcNow.AddSeconds(12)
  while (!(Test-Path -LiteralPath (Join-Path $rootPath 'release-metadata'))) {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Owned metadata holder exceeded its deadline' }
    Start-Sleep -Milliseconds 20
  }
} finally { $handle.Dispose() }
