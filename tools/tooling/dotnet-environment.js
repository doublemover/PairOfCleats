/** Bind the owned portable host independently of ambient architecture/resolver
 * overrides. External explicit runtimes retain their own selection contract.
 */
export const bindManagedDotnetEnvironment = (baseEnv, root, command, arch = process.arch) => {
  const env = { ...baseEnv };
  for (const key of Object.keys(env)) if (/^DOTNET_ROOT(?:_.*|\(x86\))?$/iu.test(key)
    || /^(DOTNET_HOST_PATH|DOTNET_MSBUILD_SDK_RESOLVER_(CLI_DIR|SDKS_DIR|SDKS_VER)|MSBuildSDKsPath|MSBUILD_EXE_PATH)$/iu.test(key)) delete env[key];
  return { ...env, DOTNET_ROOT: root, [`DOTNET_ROOT_${{ x64: 'X64', arm64: 'ARM64', ia32: 'X86' }[arch] || arch.toUpperCase()}`]: root,
    DOTNET_HOST_PATH: command, DOTNET_MSBUILD_SDK_RESOLVER_CLI_DIR: root, DOTNET_MULTILEVEL_LOOKUP: '0',
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_CLI_UI_LANGUAGE: 'en-US',
    DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: 'true' };
};
