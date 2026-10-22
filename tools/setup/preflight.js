#!/usr/bin/env node
// This entry must run with no node_modules. Bootstrap invokes it before npm
// installs anything; successful discovery is not native-build readiness.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDirectExecution } from '../../src/shared/direct-execution.js';

const listDirectories = directory => {
  try { return fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); }
  catch { return []; }
};
const versionOrder = (left, right) => {
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
};
const fail = message => { throw new Error(`[bootstrap preflight] ${message} See docs/guides/bootstrap-prerequisites.md.`); };

export const runSetupPreflight = ({ nodeVersion = process.versions.node, platform = process.platform,
  arch = process.arch, env = process.env, run = spawnSync, exists = fs.existsSync, directories = listDirectories } = {}) => {
  const runtimeVersion = /^v?26\.(\d+)\.(\d+)$/.exec(String(nodeVersion));
  if (!runtimeVersion || (Number(runtimeVersion[1]) < 12
    || (Number(runtimeVersion[1]) === 12 && Number(runtimeVersion[2]) < 1))) fail(`Node.js >=26.12.1 <27 is required; found ${nodeVersion}. Use the .nvmrc pin before installing dependencies.`);
  const probe = (command, args) => {
    try {
      const result = run(command, args, { env, encoding: 'utf8', timeout: 3000, maxBuffer: 65536, windowsHide: true });
      return result.status === 0 && !result.error ? String(result.stdout || '').trim() : null;
    } catch { return null; }
  };
  const git = probe('git', ['--version']);
  if (!git || !/^git version\s/.test(git)) fail('Git is missing or cannot run. Install Git and make it available on PATH.');
  const selectedPython = ['NODE_GYP_FORCE_PYTHON', 'npm_config_python', 'PYTHON'].find(key => String(env[key] || '').trim());
  const pythonCandidates = selectedPython ? [[env[selectedPython], [], selectedPython]] : [
    ...(platform === 'win32' ? [['py', ['-3'], 'py-launcher']] : []), ['python3', [], 'PATH'], ['python', [], 'PATH']
  ];
  let python = null;
  const rejectedPython = [];
  for (const [command, prefix, source] of pythonCandidates) {
    const output = probe(command, [...prefix, '-c', 'import json,sys; print(json.dumps({"version": list(sys.version_info[:3]), "executable": sys.executable, "releaselevel": sys.version_info.releaselevel, "serial": sys.version_info.serial}))']);
    try {
      const value = JSON.parse(output);
      if (Array.isArray(value?.version) && value.version.length === 3 && value.version.every(Number.isSafeInteger)
        && value.version[0] === 3 && value.version[1] >= 6 && typeof value.executable === 'string' && value.executable
        && ['final', 'alpha', 'beta', 'candidate'].includes(value.releaselevel) && (value.releaselevel === 'final' || selectedPython)) {
        python = { ...value, command, args: prefix, source, prerelease: value.releaselevel !== 'final' }; break;
      }
      rejectedPython.push({ command, source, reason: value?.releaselevel && value.releaselevel !== 'final' ? 'prerelease-needs-explicit-selection' : 'incompatible-or-unrecognized-python' });
    } catch { rejectedPython.push({ command, source, reason: 'unavailable-or-invalid-python-probe' }); }
    if (selectedPython) fail(`Explicit ${selectedPython}=${command} is unavailable or incompatible with Python 3.6+. Repair this selection; no launcher/PATH fallback was used.`);
  }
  if (!python) fail('Python 3.6+ is required for mandatory native source builds. Install a maintained stable Python 3, or explicitly select a compatible interpreter; prerelease PATH candidates are not selected by default.');
  let toolchain;
  if (platform === 'win32') {
    if (!['x64', 'arm64'].includes(arch)) fail(`Windows ${arch} is unsupported; Node 26 requires a supported 64-bit target.`);
    const join = path.win32.join;
    const programRoots = [...new Set([env['ProgramFiles(x86)'], env.ProgramFiles].filter(Boolean))];
    const vswhere = programRoots.map(root => join(root, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')).find(exists);
    let instances = [];
    try { instances = JSON.parse(vswhere ? probe(vswhere, ['-all', '-products', '*', '-format', 'json', '-utf8']) : '[]'); } catch { /* Report missing discovery below. */ }
    if (!Array.isArray(instances)) instances = [];
    const configuredYear = String(env.npm_config_msvs_version || env.GYP_MSVS_VERSION || '');
    const configuredRoot = env.VCINSTALLDIR ? path.win32.resolve(env.VCINSTALLDIR, '..')
      : configuredYear && !/^20\d\d$/.test(configuredYear) ? path.win32.resolve(configuredYear) : null;
    const eligible = instances.filter(instance => {
      const version = Number(String(instance.installationVersion).split('.')[0]);
      return instance.isComplete !== false && typeof instance.installationPath === 'string' && version >= 17
        && (!configuredRoot || path.win32.normalize(instance.installationPath).toLowerCase() === configuredRoot.toLowerCase())
        && (!/^20\d\d$/.test(configuredYear) || version === (configuredYear === '2022' ? 17 : configuredYear === '2026' ? 18 : -1));
    }).sort((a, b) => versionOrder(b.installationVersion, a.installationVersion));
    let compiler = null;
    for (const instance of eligible) {
      const base = instance.installationPath, tools = join(base, 'VC', 'Tools', 'MSVC');
      const msbuild = join(base, 'MSBuild', 'Current', 'Bin', 'MSBuild.exe');
      if (!exists(msbuild) || !exists(join(base, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat'))) continue;
      for (const version of directories(tools).filter(value => /^\d+(?:\.\d+)+$/.test(value)).sort(versionOrder).reverse()) {
        const hosts = arch === 'arm64' ? ['Hostarm64', 'Hostx64'] : ['Hostx64'];
        const executable = hosts.map(host => join(tools, version, 'bin', host, arch, 'cl.exe')).find(exists);
        if (executable) { compiler = { installationPath: base, installationVersion: instance.installationVersion,
          productId: instance.productId || null, source: configuredRoot ? 'explicit-path' : configuredYear ? 'explicit-version' : 'vswhere',
          version, executable, msbuild }; break; }
      }
      if (compiler) break;
    }
    if (!compiler) fail('Visual Studio 2022/2026 C++ build tools and MSBuild are required. Install the Desktop development with C++ workload (including target architecture tools); check any selected VS environment.');
    const sdkRoots = [...new Set([env.WindowsSdkDir, ...programRoots.map(root => join(root, 'Windows Kits', '10'))].filter(Boolean))];
    if (env.SystemRoot) {
      const output = probe(join(env.SystemRoot, 'System32', 'reg.exe'), ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows Kits\\Installed Roots', '/v', 'KitsRoot10', '/reg:32']);
      const registryRoot = /KitsRoot10\s+REG_SZ\s+([^\r\n]+)/i.exec(output || '')?.[1]?.trim();
      if (registryRoot) sdkRoots.push(registryRoot);
    }
    let sdk = null;
    for (const root of sdkRoots) {
      for (const version of directories(join(root, 'Include')).filter(value => /^10\.0\.\d+\.\d+$/.test(value) && Number(value.split('.')[2]) >= 22000).sort(versionOrder).reverse()) {
        if (['um/Windows.h', 'ucrt/stdio.h'].every(file => exists(join(root, 'Include', version, file)))
          && exists(join(root, 'Lib', version, 'um', arch, 'kernel32.lib'))
          && exists(join(root, 'Lib', version, 'ucrt', arch, 'ucrt.lib'))) { sdk = { root, version }; break; }
      }
      if (sdk) break;
    }
    if (!sdk) fail('Windows 11 SDK headers and target libraries are required for native source builds. Add the SDK using Visual Studio Installer.');
    toolchain = { compiler, sdk };
  } else {
    const make = probe('make', ['--version']);
    if (!make) fail('Make is required for native source builds. Install the platform build tools.');
    let compiler = null;
    for (const command of [...new Set([env.CXX, 'c++', 'clang++', 'g++'].filter(Boolean))]) {
      const version = probe(command, ['--version']);
      if (version) { compiler = { command, source: command === env.CXX ? 'CXX' : 'PATH', version: version.split(/\r?\n/)[0] }; break; }
      if (command === env.CXX) fail('The explicitly selected CXX compiler cannot run; repair the override before bootstrap.');
    }
    if (!compiler) fail('A supported C/C++ compiler is required for mandatory native source builds. Install the platform build tools.');
    let cCompiler = null;
    if (env.CC) {
      const version = probe(env.CC, ['--version']);
      if (!version) fail('The explicitly selected CC compiler cannot run; repair the override before bootstrap.');
      cCompiler = { command: env.CC, source: 'CC', version: version.split(/\r?\n/)[0] };
    }
    toolchain = { make: make.split(/\r?\n/)[0], compiler, cCompiler };
  }
  const childEnv = { NODE_GYP_FORCE_PYTHON: python.executable, npm_config_python: python.executable };
  if (platform === 'win32') {
    childEnv.GYP_MSVS_VERSION = toolchain.compiler.installationPath;
    childEnv.npm_config_msvs_version = toolchain.compiler.installationPath;
    childEnv.WindowsSdkDir = toolchain.sdk.root;
    childEnv.WindowsSDKVersion = toolchain.sdk.version + '\\';
  } else {
    if (env.CXX) childEnv.CXX = toolchain.compiler.command;
    if (env.CC) childEnv.CC = toolchain.cCompiler.command;
  }
  const npm = { executable: env.npm_execpath || null, nodeExecutable: env.npm_node_execpath || process.execPath,
    version: /(?:^|\s)npm\/([0-9]+\.[0-9]+\.[0-9]+)(?:\s|$)/.exec(env.npm_config_user_agent || '')?.[1] || null,
    source: env.npm_execpath ? 'npm-launch-environment' : 'not-selected-by-launch', verificationLevel: 'launch-context-not-probed' };
  return { nodeVersion, nodeExecutable: process.execPath, platform, arch, npm, git, python, toolchain,
    rejectedPython, childEnv, verificationLevel: 'prerequisite-discovery-only' };
};

export const formatSetupPreflight = report => [
  `[bootstrap preflight] Node ${report.nodeVersion} (${report.nodeExecutable}); target ${report.platform}/${report.arch}`,
  `[bootstrap preflight] npm ${report.npm.version || 'version not probed'} (${report.npm.executable || 'entry not selected by launch'}; ${report.npm.source})`,
  `[bootstrap preflight] Python ${report.python.version.join('.')}${report.python.prerelease ? ` ${report.python.releaselevel} (explicit opt-in)` : ''} (${report.python.executable}; selected by ${report.python.source})`,
  ...(report.platform === 'win32' ? [
    `[bootstrap preflight] Visual Studio ${report.toolchain.compiler.installationVersion}; MSVC ${report.toolchain.compiler.version} (${report.toolchain.compiler.source})`,
    `[bootstrap preflight] C++: ${report.toolchain.compiler.executable}`,
    `[bootstrap preflight] MSBuild: ${report.toolchain.compiler.msbuild}`,
    `[bootstrap preflight] Windows SDK ${report.toolchain.sdk.version}: ${report.toolchain.sdk.root}`
  ] : [`[bootstrap preflight] C++: ${report.toolchain.compiler.command} (${report.toolchain.compiler.source}); ${report.toolchain.compiler.version}`]),
  '[bootstrap preflight] Discovery only. Native build, actual child selection and activation verification remain required.'
].join('\n');

if (isDirectExecution(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--json')) fail('Usage: node tools/setup/preflight.js [--json]');
    const report = runSetupPreflight();
    if (args.includes('--json')) console.log(JSON.stringify({ ok: true, ...report }));
    else console.error(formatSetupPreflight(report));
  } catch (error) {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, verificationLevel: 'prerequisite-discovery-only', message: error.message }));
    else console.error(error.message);
    process.exitCode = 1;
  }
}
