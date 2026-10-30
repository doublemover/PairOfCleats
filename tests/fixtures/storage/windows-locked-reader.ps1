param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
$reader = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open,
  [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
try {
  [Console]::Out.WriteLine('reader-ready')
  [Console]::Out.Flush()
  $null = [Console]::In.ReadLine()
  $reader.Position = 0
  $text = [System.IO.StreamReader]::new($reader)
  try {
    [Console]::Out.WriteLine($text.ReadToEnd())
    [Console]::Out.Flush()
  } finally { $text.Dispose() }
} finally { $reader.Dispose() }
