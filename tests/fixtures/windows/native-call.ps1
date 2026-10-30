# Fixed fixture-owned native signatures. Avoid launching a C# compiler merely
# to observe console modes or hold a Windows file-disposition handle.
function New-PocNativeCall {
  param([IntPtr]$Library, [string]$Name, [type]$ReturnType, [type[]]$ParameterTypes)
  $address = [Runtime.InteropServices.NativeLibrary]::GetExport($Library, $Name)
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
