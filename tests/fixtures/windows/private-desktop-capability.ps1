# Dependency-free capability probe. Starts no child application or test window.
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot '../../helpers/windows/private-desktop.cs')
$desktop = [PairOfCleats.Tests.PrivateDesktop]::new()
try {
  $receipt = @{ Station = $desktop.Station; OriginalDesktop = $desktop.OriginalDesktop;
    PrivateDesktop = $desktop.Name; OriginalThreadRestored = $desktop.OriginalThreadRestored }
} finally { $desktop.Dispose() }
$receipt.PrivateHandleClosed = $desktop.PrivateHandleClosed
$receipt | ConvertTo-Json -Compress
