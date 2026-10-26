import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveWindowsCmdInvocation } from '../../../src/shared/subprocess/windows-cmd.js';
import { resolveEnvPath } from '../../../src/shared/env-path.js';
import { stableStringifyForSignature } from '../../../src/shared/stable-json.js';
import { createBinaryDiscovery } from '../../../src/index/tooling/binary-utils.js';
import { buildBenchEnvironmentMetadata } from './logging.js';

const VERSION_PROBE_TIMEOUT_MS = 1500;
export const CANARY_ENVIRONMENT_CONTEXT_VERSION = 2;
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const hash = value => crypto.createHash('sha256').update(stableStringifyForSignature(value)).digest('hex');
const ownEnv = value => Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(value || {}))
  .filter(([, descriptor]) => Object.hasOwn(descriptor, 'value') && descriptor.value != null)
  .map(([key, descriptor]) => [process.platform === 'win32' ? key.toUpperCase() : key, String(descriptor.value)]));

/** Full execution values stay private/non-enumerable; diagnostics retain only
 * the existing safe projection. One immutable plan owns probes and launch. */
export const createCanaryRunnerPlan = ({ cmd, args, cwd, overrides = {}, parentEnv = process.env, workDir, outJsonPath }) => {
  const parent = ownEnv(parentEnv), env = Object.freeze({ ...parent, ...ownEnv(overrides) });
  const executable = createBinaryDiscovery({ cwd }); executable.select(cmd);
  const plan = { cmd, args: Object.freeze([...args]), cwd: path.resolve(cwd),
    executable: freeze(executable.getReceipt().selected || null),
    parent: freeze(buildBenchEnvironmentMetadata(parent)),
    operationalPaths: Object.freeze({ workDir, outJsonPath }), overrideKeys: Object.freeze(Object.keys(ownEnv(overrides)).sort()) };
  Object.defineProperty(plan, 'env', { value: env });
  return Object.freeze(plan);
};

const BENCH_RUNTIME_ENVIRONMENT_PROBES = freeze([
  { id: 'node', command: process.execPath, args: ['-p', 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})'] },
  { id: 'git', command: 'git', args: ['--version'] },
  { id: 'npm', command: 'npm', args: ['--version'] },
  { id: 'cargo', command: 'cargo', args: ['--version'] },
  { id: 'rustc', command: 'rustc', args: ['--version'] },
  { id: 'go', command: 'go', args: ['version'] },
  { id: 'swift', command: 'swift', args: ['--version'] },
  { id: 'python', command: 'python', args: ['--version'] },
  { id: 'gopls', command: 'gopls', args: ['version'] },
  { id: 'sourcekit-lsp', command: 'sourcekit-lsp', args: ['--version'] },
  { id: 'rust-analyzer', command: 'rust-analyzer', args: ['--version'] }
]);


const inferExpectedPlatform = (value) => {
  const text = String(value || '').trim().toLowerCase();
  if (!text || text.includes('cross-platform')) return null;
  if (text.includes('windows')) return 'win32';
  if (text.includes('macos') || text.includes('darwin')) return 'darwin';
  if (text.includes('linux')) return 'linux';
  return null;
};

const collectExpectedProbeIds = (entry) => {
  const corpus = [
    entry?.environment?.toolchain,
    entry?.environment?.providerAvailability,
    entry?.repo,
    entry?.profile
  ].map((value) => String(value || '').toLowerCase()).join(' ');
  const ids = new Set(['node', 'git', 'npm']);
  if (corpus.includes('rust')) {
    ids.add('cargo');
    ids.add('rustc');
    ids.add('rust-analyzer');
  }
  if (/(?:^|[^a-z0-9])(?:go|golang|gopls)(?:$|[^a-z0-9])/u.test(corpus)) {
    ids.add('go');
    ids.add('gopls');
  }
  if (corpus.includes('swift') || corpus.includes('sourcekit')) {
    ids.add('swift');
    ids.add('sourcekit-lsp');
  }
  if (corpus.includes('python')) ids.add('python');
  return Array.from(ids).sort((left, right) => left.localeCompare(right));
};

export const runCanaryVersionProbe = (probe, plan) => {
  const discovery = createBinaryDiscovery({ cwd: plan.cwd });
  discovery.findOnPath(probe.command, resolveEnvPath(plan.env));
  const selected = discovery.getReceipt().selected;
  const execution = { requestedCommand: probe.command, resolvedExecutable: selected?.absolutePath || null,
    identity: selected?.identity || null, identityScope: 'advisory-executable-stat', cwd: plan.cwd };
  if (!selected) return { available: false, version: null, exitCode: null, execution, error: 'probe executable unavailable' };
  try {
    const invocation = process.platform === 'win32'
      ? resolveWindowsCmdInvocation(selected.absolutePath, probe.args, plan.env)
      : { command: selected.absolutePath, args: probe.args };
    const result = spawnSync(invocation.command, invocation.args, {
      windowsVerbatimArguments: invocation.windowsVerbatimArguments === true, windowsHide: true,
      cwd: plan.cwd, env: invocation.env ? { ...plan.env, ...invocation.env } : plan.env,
      stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: VERSION_PROBE_TIMEOUT_MS, maxBuffer: 16384
    });
    const exitCode = Number.isInteger(result.status) ? result.status : null;
    let version = String(result.stdout || result.stderr || '').trim().slice(0, 4096) || null, runtime = null;
    if (probe.id === 'node' && exitCode === 0) {
      const value = JSON.parse(String(result.stdout || ''));
      if (!/^v\d+\.\d+\.\d+/u.test(value.version) || typeof value.platform !== 'string' || typeof value.arch !== 'string') throw new Error('Node runtime probe returned no qualified runtime identity.');
      version = value.version;
      runtime = { nodeVersion: value.version, platform: value.platform, arch: value.arch };
    }
    return { available: exitCode === 0 && !result.signal && !result.error && Boolean(version), version,
      exitCode, execution, ...(runtime ? { runtime } : {}),
      ...(result.error ? { error: String(result.error.message || result.error).slice(0, 512) } : {}) };
  } catch (error) {
    return { available: false, version: null, exitCode: null, execution, error: String(error?.message || error).slice(0, 512) };
  }
};

const projectProbe = (value, probe, plan) => {
  const version = typeof value?.version === 'string' && value.version.trim() ? value.version.trim().slice(0, 4096) : null;
  const exitCode = Number.isInteger(value?.exitCode) ? value.exitCode : null;
  const available = value?.available === true && exitCode === 0 && Boolean(version);
  const runtime = value?.runtime, execution = value?.execution;
  const text = input => typeof input === 'string' ? input.slice(0, 4096) : null;
  return { available, version: available ? version : null, exitCode,
    ...(runtime && available ? { runtime: { nodeVersion: text(runtime.nodeVersion), platform: text(runtime.platform), arch: text(runtime.arch) } } : {}),
    execution: { requestedCommand: probe.command, cwd: plan.cwd, resolvedExecutable: text(execution?.resolvedExecutable),
      identityScope: 'advisory-executable-stat', identity: execution?.identity ? Object.fromEntries(
        ['dev', 'ino', 'size', 'mtimeNs', 'mode'].map(key => [key, text(execution.identity[key])])) : null },
    ...(!available ? { error: text(value?.error) || 'version probe unavailable', diagnostic: version } : {}) };
};

/** Cache only inside this exact immutable invocation. A new invocation probes
 * afresh, including equivalent-looking plans whose local tool config changed.
 * No process-lifetime cache, full-env key or secret-derived fingerprint exists. */
export const createCanaryEnvironmentOwner = ({ entry, plan, probeRunner = runCanaryVersionProbe }) => {
  const probeIds = collectExpectedProbeIds(entry);
  const declaredContract = entry?.environment ? JSON.parse(stableStringifyForSignature(entry.environment)) : null;
  let snapshot = null;
  return () => {
    if (snapshot) return snapshot;
    const probes = Object.fromEntries(BENCH_RUNTIME_ENVIRONMENT_PROBES.filter(probe => probeIds.includes(probe.id))
      .map(probe => [probe.id, { ...projectProbe(probeRunner(probe, plan), probe, plan), evidenceScope: probeRunner === runCanaryVersionProbe
        ? 'effective-child-context-version-probe' : 'injected-probe-contract' }]));
    const projected = buildBenchEnvironmentMetadata(plan.env), runtime = probes.node?.available ? probes.node.runtime : null;
    const actual = { projectionVersion: projected.projectionVersion, contextVersion: CANARY_ENVIRONMENT_CONTEXT_VERSION,
      platform: runtime?.platform || null, arch: runtime?.arch || null, nodeVersion: runtime?.nodeVersion || null,
      selected: projected.selected };
    actual.fingerprint = 'sha256:' + hash(actual);
    const mismatches = [], expectedPlatform = inferExpectedPlatform(entry?.environment?.os);
    if (expectedPlatform && actual.platform !== expectedPlatform) mismatches.push(`expected platform ${expectedPlatform}, got ${actual.platform || 'unknown'}`);
    for (const id of probeIds) if (!probes[id]?.available && id !== 'git' && id !== 'npm') mismatches.push(`expected tool/provider ${id} to be available`);
    const scope = probeRunner === runCanaryVersionProbe ? 'effective-child-runner' : 'injected-probe-contract';
    const toolSelectionKeys = new Set(['PATH', 'PATHEXT', 'COMSPEC']);
    const unrepresentedOverrideKeys = plan.overrideKeys.filter(key => !Object.hasOwn(projected.selected, key) && !toolSelectionKeys.has(key));
    const comparison = { state: scope !== 'effective-child-runner' ? 'synthetic' : mismatches.length || !runtime ? 'unavailable'
      : unrepresentedOverrideKeys.length ? 'partial' : 'qualified',
    coverage: 'allowlisted-environment-and-requested-tool-observations', unrepresentedOverrideKeys };
    const comparablePath = value => {
      if (typeof value !== 'string' || !path.isAbsolute(value)) return value;
      if (value === plan.operationalPaths.outJsonPath) return '{outJsonPath}';
      const root = plan.operationalPaths.workDir;
      if (root) {
        const relative = path.relative(root, value);
        if (!relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) {
          return '{workDir}' + (relative ? '/' + relative.split(path.sep).join('/') : '');
        }
      }
      return value;
    };
    const executable = value => value ? { ...value, path: comparablePath(value.path),
      absolutePath: comparablePath(value.absolutePath), targetPath: comparablePath(value.targetPath) } : null;
    const comparableProbes = Object.fromEntries(Object.entries(probes).map(([id, probe]) => [id, { ...probe,
      execution: { ...probe.execution, cwd: comparablePath(probe.execution.cwd),
        resolvedExecutable: comparablePath(probe.execution.resolvedExecutable) } }]));
    const fingerprint = 'sha256:' + hash({ contextVersion: CANARY_ENVIRONMENT_CONTEXT_VERSION,
      actual, probes: comparableProbes, cwd: comparablePath(plan.cwd), executable: executable(plan.executable), comparison });
    snapshot = freeze({ contextVersion: CANARY_ENVIRONMENT_CONTEXT_VERSION, evidenceScope: scope,
      freshness: 'one-immutable-runner-invocation', parent: { evidenceScope: 'parent-bootstrap', actual: plan.parent },
      declaredContract, actual, probes, expectedProbeIds: probeIds, mismatches, comparison,
      fingerprint, comparisonFingerprint: comparison.state === 'qualified' ? fingerprint : null,
      runnerContext: { cmd: plan.cmd, cwd: plan.cwd, executable: plan.executable,
        overrideKeys: plan.overrideKeys, operationalPaths: plan.operationalPaths } });
    return snapshot;
  };
};
