param([string]$LockPath)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PendingFile {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr CreateFileW(string path, uint access, uint share, IntPtr security, uint mode, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool SetFileInformationByHandle(IntPtr handle, int kind, ref int value, uint length);
  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr handle);
}
'@
# DELETE access, all share modes, OPEN_EXISTING. FileDispositionInfo preserves
# the real native delete-pending interval until this owning handle closes.
$handle = [PendingFile]::CreateFileW($LockPath, 65536, 7, [IntPtr]::Zero, 3, 128, [IntPtr]::Zero)
if ($handle -eq [IntPtr]::new(-1)) {
  throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
}
try {
  $delete = 1
  if (-not [PendingFile]::SetFileInformationByHandle($handle, 4, [ref]$delete, 4)) {
    throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
  [Console]::Out.WriteLine('native-delete-pending')
  [Console]::Out.Flush()
  $null = [Console]::In.ReadLine()
} finally {
  $null = [PendingFile]::CloseHandle($handle)
}
