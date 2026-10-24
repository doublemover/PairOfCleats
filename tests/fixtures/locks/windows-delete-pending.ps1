param([string]$LockPath)
$ErrorActionPreference = 'Stop'
[Console]::Out.WriteLine('native-api-loading')
[Console]::Out.Flush()
$library = [Runtime.InteropServices.NativeLibrary]::Load('kernel32.dll')
# Call the same native APIs without starting the C# compiler in a timed fixture.
# Primitive/pointer arguments use explicit UTF-16 path and disposition storage.
function New-NativeCall {
  param([string]$Name, [type]$ReturnType, [type[]]$ParameterTypes)
  $address = [Runtime.InteropServices.NativeLibrary]::GetExport($library, $Name)
  $method = [Reflection.Emit.DynamicMethod]::new($Name, $ReturnType, $ParameterTypes)
  $il = $method.GetILGenerator()
  for ($index = 0; $index -lt $ParameterTypes.Length; $index++) {
    $il.Emit([Reflection.Emit.OpCodes]::Ldarg, [int16]$index)
  }
  $il.Emit([Reflection.Emit.OpCodes]::Ldc_I8, $address.ToInt64())
  $il.Emit([Reflection.Emit.OpCodes]::Conv_I)
  $il.EmitCalli([Reflection.Emit.OpCodes]::Calli,
    [Runtime.InteropServices.CallingConvention]::StdCall, $ReturnType, $ParameterTypes)
  $il.Emit([Reflection.Emit.OpCodes]::Ret)
  return $method
}
$create = New-NativeCall 'CreateFileW' ([IntPtr]) @([IntPtr], [uint32], [uint32], [IntPtr], [uint32], [uint32], [IntPtr])
$setDisposition = New-NativeCall 'SetFileInformationByHandle' ([int]) @([IntPtr], [int], [IntPtr], [uint32])
$close = New-NativeCall 'CloseHandle' ([int]) @([IntPtr])
[Console]::Out.WriteLine('native-api-ready')
[Console]::Out.Flush()
$pathPointer = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($LockPath)
$deletePointer = [Runtime.InteropServices.Marshal]::AllocHGlobal(4)
$handle = [IntPtr]::new(-1)
try {
  # DELETE access, all share modes, OPEN_EXISTING. The real pending-delete
  # interval ends only when this owning handle closes.
  $handle = $create.Invoke($null, @($pathPointer, [uint32]65536, [uint32]7, [IntPtr]::Zero,
    [uint32]3, [uint32]128, [IntPtr]::Zero))
  if ($handle -eq [IntPtr]::new(-1)) { throw 'CreateFileW failed' }
  [Runtime.InteropServices.Marshal]::WriteInt32($deletePointer, 1)
  $result = $setDisposition.Invoke($null, @($handle, [int]4, $deletePointer, [uint32]4))
  if ($result -eq 0) { throw 'SetFileInformationByHandle(FileDispositionInfo) failed' }
  [Console]::Out.WriteLine('native-delete-pending')
  [Console]::Out.Flush()
  $null = [Console]::In.ReadLine()
} finally {
  try {
    if ($handle -ne [IntPtr]::new(-1) -and $close.Invoke($null, @($handle)) -eq 0) {
      throw 'CloseHandle failed'
    }
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($deletePointer)
    [Runtime.InteropServices.Marshal]::FreeHGlobal($pathPointer)
    [Runtime.InteropServices.NativeLibrary]::Free($library)
  }
}
