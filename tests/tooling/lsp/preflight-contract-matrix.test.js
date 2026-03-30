#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  awaitToolingProviderPreflight,
  getToolingProviderPreflightSchedulerMetrics,
  kickoffToolingProviderPreflights,
  listToolingProviderPreflightStates,
  readToolingProviderPreflightState,
  teardownToolingProviderPreflights
} from '../../../src/index/tooling/preflight-manager.js';
import {
  mergePreflightChecks,
  resolveCommandProfilePreflightResult,
  resolveRuntimeCommandFromPreflight
} from '../../../src/index/tooling/preflight/command-profile-preflight.js';
import {
  TOOLING_PREFLIGHT_REASON_CODES,
  TOOLING_PREFLIGHT_STATES,
  buildToolingPreflightDiagnostic,
  isValidToolingPreflightTransition,
  normalizeToolingPreflightResult
} from '../../../src/index/tooling/preflight/contract.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { listToolingProviders } from '../../../src/index/tooling/provider-registry.js';
import { listLspServerPresets } from '../../../src/index/tooling/lsp-presets.js';

const root = process.cwd();
const toolingRoot = path.join(root, 'src', 'index', 'tooling');
const expectedPreflightEntrypoint = path.join('src', 'index', 'tooling', 'preflight-manager.js').replace(/\\/g, '/');
const providerPreflightCallPattern = /\bprovider\.preflight\s*\(/;
const runtimeFiles = [
  'src/index/tooling/lsp-provider/factory.js',
  'src/index/tooling/dedicated-lsp-provider.js',
  'src/index/tooling/pyright-provider.js',
  'src/index/tooling/clangd-provider.js',
  'src/index/tooling/sourcekit-provider.js'
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const walkJsFiles = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkJsFiles(abs));
      continue;
    }
    if (entry.isFile() && abs.endsWith('.js')) out.push(abs);
  }
  return out;
};

const buildCtx = ({ logger = () => {}, toolingConfig = {} } = {}) => ({
  repoRoot: root,
  buildRoot: root,
  toolingConfig,
  logger
});

const buildInputs = (suffix = 'fixture') => ({
  documents: [{ virtualPath: `src/${suffix}.fixture`, languageId: 'fixture' }],
  targets: [{ chunkRef: { chunkUid: `chunk-${suffix}`, chunkId: `chunk-${suffix}`, file: `src/${suffix}.fixture` } }]
});

const runGuardCases = () => {
  const matches = [];
  for (const abs of walkJsFiles(toolingRoot)) {
    const content = fs.readFileSync(abs, 'utf8');
    if (providerPreflightCallPattern.test(content)) {
      matches.push(path.relative(root, abs).replace(/\\/g, '/'));
    }
  }
  assert.equal(matches.length > 0, true);
  assert.deepEqual(matches, [expectedPreflightEntrypoint]);

  const bannedSnippets = [
    'preflight?.commandProfile && typeof preflight.commandProfile === \'object\'\n      ? preflight.commandProfile\n      : resolveToolingCommandProfile(',
    'if (!commandProfile) {\n        commandProfile = resolveToolingCommandProfile('
  ];
  for (const relativePath of runtimeFiles) {
    const content = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.equal(content.includes('resolveRuntimeCommandFromPreflight('), true, `expected helper usage in ${relativePath}`);
    assert.equal(content.includes('await awaitToolingProviderPreflight('), true, `expected preflight await usage in ${relativePath}`);
    for (const snippet of bannedSnippets) {
      assert.equal(content.includes(snippet), false, `unexpected runtime reprobe snippet in ${relativePath}`);
    }
  }
};

const runMetadataCoverageCase = () => {
  registerDefaultToolingProviders();
  const toolingConfig = {
    lsp: {
      enabled: true,
      servers: listLspServerPresets().map((preset) => ({
        id: preset.id,
        preset: preset.id,
        cmd: preset.cmd,
        args: Array.isArray(preset.args) ? preset.args : preset.args ? [preset.args] : [],
        languages: Array.isArray(preset.languages) ? preset.languages : []
      }))
    }
  };
  const providers = listToolingProviders(toolingConfig);
  const preflightProviders = providers.filter((provider) => typeof provider?.preflight === 'function');
  assert.equal(preflightProviders.length > 0, true);

  const validClasses = new Set(['probe', 'workspace', 'dependency']);
  const validPolicies = new Set(['required', 'optional']);
  for (const provider of preflightProviders) {
    const id = String(provider?.id || '<unknown>');
    assert.equal(typeof provider.preflightId === 'string' && provider.preflightId.trim().length > 0, true, `expected preflightId for ${id}`);
    assert.equal(validClasses.has(String(provider.preflightClass || '').trim().toLowerCase()), true, `expected preflightClass for ${id}`);
    assert.equal(validPolicies.has(String(provider.preflightPolicy || '').trim().toLowerCase()), true, `expected preflightPolicy for ${id}`);
    assert.equal(Array.isArray(provider.preflightRuntimeRequirements), true, `expected preflightRuntimeRequirements for ${id}`);
    for (const requirement of provider.preflightRuntimeRequirements) {
      assert.equal(Boolean(String(requirement?.id || '').trim()), true, `expected requirement id for ${id}`);
      assert.equal(Boolean(String(requirement?.cmd || '').trim()), true, `expected requirement cmd for ${id}`);
    }
  }
};

const runCommandProfileHelperCase = () => {
  const ctx = { repoRoot: root, toolingConfig: {} };
  const ready = resolveCommandProfilePreflightResult({
    providerId: 'fixture',
    requestedCommand: { cmd: process.execPath, args: ['--version'] },
    ctx,
    unavailableCheck: { name: 'fixture_command_unavailable', status: 'warn', message: 'fixture command unavailable' }
  });
  assert.equal(ready.state, 'ready');
  assert.equal(ready.reasonCode, null);
  assert.equal(ready.commandProfile?.probe?.ok, true);

  const degraded = resolveCommandProfilePreflightResult({
    providerId: 'fixture',
    requestedCommand: { cmd: 'definitely-missing-command-for-preflight-helper-test', args: [] },
    ctx,
    unavailableCheck: { name: 'fixture_command_unavailable', status: 'warn', message: 'fixture command unavailable' }
  });
  assert.equal(degraded.state, 'degraded');
  assert.equal(degraded.reasonCode, 'preflight_command_unavailable');
  assert.equal(degraded.check?.name, 'fixture_command_unavailable');

  const blocked = resolveCommandProfilePreflightResult({
    providerId: 'fixture',
    requestedCommand: { cmd: 'definitely-missing-command-for-preflight-helper-test', args: [] },
    ctx,
    blockWhenDefinitelyMissing: true,
    blockFlag: 'blockSourcekit',
    unavailableCheck: { name: 'fixture_command_unavailable', status: 'warn', message: 'fixture command unavailable' }
  });
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.blockSourcekit, true);
  assert.equal(blocked.definitelyMissing, true);

  const runtimeUnknownProbe = resolveRuntimeCommandFromPreflight({
    preflight: {
      requestedCommand: { cmd: process.execPath, args: ['--version'] }
    },
    fallbackRequestedCommand: { cmd: '', args: [] },
    missingProfileCheck: { name: 'fixture_preflight_command_profile_missing', status: 'warn', message: 'missing profile' }
  });
  assert.equal(runtimeUnknownProbe.cmd, process.execPath);
  assert.equal(runtimeUnknownProbe.probeKnown, true);
  assert.equal(runtimeUnknownProbe.probeOk, true);
  assert.equal(runtimeUnknownProbe.checks.length, 0);

  const runtimeResolvedFromFallback = resolveRuntimeCommandFromPreflight({
    preflight: {
      state: 'degraded',
      reasonCode: 'timeout',
      requestedCommand: { cmd: 'pyright-langserver', args: ['--stdio'] }
    },
    fallbackRequestedCommand: { cmd: '', args: [] },
    providerId: 'pyright',
    repoRoot: root,
    toolingConfig: {},
    missingProfileCheck: { name: 'fixture_preflight_command_profile_missing', status: 'warn', message: 'missing profile' }
  });
  assert.equal(path.basename(runtimeResolvedFromFallback.cmd).toLowerCase().startsWith('pyright-langserver'), true);
  assert.deepEqual(runtimeResolvedFromFallback.args, ['--stdio']);
  assert.equal(runtimeResolvedFromFallback.probeKnown, true);
  assert.equal(runtimeResolvedFromFallback.commandProfile?.resolved?.cmd?.length > 0, true);

  const dedupedChecks = mergePreflightChecks(
    [{ name: 'a', status: 'warn', message: 'm' }, { name: 'a', status: 'warn', message: 'm' }],
    { name: 'b', status: 'warn', message: 'm2' },
    [{ name: 'b', status: 'warn', message: 'm2' }]
  );
  assert.equal(dedupedChecks.length, 2);
};

const runContractCase = () => {
  assert.equal(isValidToolingPreflightTransition(TOOLING_PREFLIGHT_STATES.IDLE, TOOLING_PREFLIGHT_STATES.RUNNING), true);
  assert.equal(isValidToolingPreflightTransition(TOOLING_PREFLIGHT_STATES.RUNNING, TOOLING_PREFLIGHT_STATES.READY), true);
  assert.equal(isValidToolingPreflightTransition(TOOLING_PREFLIGHT_STATES.READY, TOOLING_PREFLIGHT_STATES.RUNNING), false);

  const blockedResult = normalizeToolingPreflightResult({ blockSourcekit: true, timeout: false });
  assert.equal(blockedResult.state, TOOLING_PREFLIGHT_STATES.BLOCKED);
  assert.equal(blockedResult.reasonCode, TOOLING_PREFLIGHT_REASON_CODES.LOCK_UNAVAILABLE);

  const timeoutResult = normalizeToolingPreflightResult({ state: 'degraded', timeout: true });
  assert.equal(timeoutResult.state, TOOLING_PREFLIGHT_STATES.DEGRADED);
  assert.equal(timeoutResult.reasonCode, TOOLING_PREFLIGHT_REASON_CODES.TIMEOUT);

  const diagnostic = buildToolingPreflightDiagnostic({
    providerId: 'sourcekit',
    preflightId: 'sourcekit.package-resolution',
    state: TOOLING_PREFLIGHT_STATES.READY,
    reasonCode: TOOLING_PREFLIGHT_REASON_CODES.CACHE_HIT,
    message: 'cached preflight',
    durationMs: 11,
    timedOut: false,
    cached: true,
    startedAtMs: 100,
    finishedAtMs: 111
  });
  assert.equal(diagnostic.providerId, 'sourcekit');
  assert.equal(diagnostic.preflightId, 'sourcekit.package-resolution');
  assert.equal(diagnostic.state, TOOLING_PREFLIGHT_STATES.READY);
  assert.equal(diagnostic.reasonCode, TOOLING_PREFLIGHT_REASON_CODES.CACHE_HIT);
  assert.equal(diagnostic.durationMs, 11);
  assert.equal(diagnostic.cached, true);
  assert.equal(typeof diagnostic.startedAt, 'string');
  assert.equal(typeof diagnostic.finishedAt, 'string');
};

const runSingleFlightCase = async () => {
  const logs = [];
  const ctx = buildCtx({ logger: (line) => logs.push(String(line || '')) });

  let runCount = 0;
  const provider = {
    id: 'sourcekit-single-flight',
    preflightId: 'sourcekit-single-flight.package-resolution',
    getConfigHash() {
      return 'hash-a';
    },
    async preflight() {
      runCount += 1;
      await wait(40);
      return { state: 'ready', blockSourcekit: false, check: null };
    }
  };

  const inputs = buildInputs('single-flight');
  const waveToken = kickoffToolingProviderPreflights(ctx, [{ provider, ...inputs }]);
  assert.equal(typeof waveToken, 'string');
  await wait(5);
  const runningSnapshot = readToolingProviderPreflightState(ctx, { provider, inputs });
  assert.equal(runningSnapshot?.state, 'running');

  const first = await awaitToolingProviderPreflight(ctx, { provider, inputs, waveToken });
  const second = await awaitToolingProviderPreflight(ctx, { provider, inputs, waveToken });
  assert.equal(runCount, 1);
  assert.equal(first?.state, 'ready');
  assert.equal(second?.state, 'ready');
  assert.ok(logs.some((line) => line.includes('preflight:start provider=sourcekit-single-flight')));
  assert.ok(logs.some((line) => line.includes('preflight:ok provider=sourcekit-single-flight')));
  assert.ok(logs.some((line) => line.includes('preflight:cache_hit provider=sourcekit-single-flight')));

  const snapshots = listToolingProviderPreflightStates(ctx);
  const successSnapshot = snapshots.find((entry) => entry.providerId === 'sourcekit-single-flight');
  assert.equal(successSnapshot?.state, 'ready');
  assert.equal(successSnapshot?.diagnostic?.state, 'ready');

  let rejectCount = 0;
  const failingProvider = {
    id: 'sourcekit-failing',
    preflightId: 'sourcekit-failing.package-resolution',
    preflightPolicy: 'required',
    getConfigHash() {
      return 'hash-b';
    },
    async preflight() {
      rejectCount += 1;
      throw new Error('forced preflight failure');
    }
  };
  const failingInputs = buildInputs('single-flight-fail');
  const failingWaveToken = 'failing-wave';
  await assert.rejects(
    () => awaitToolingProviderPreflight(ctx, { provider: failingProvider, inputs: failingInputs, waveToken: failingWaveToken }),
    /forced preflight failure/
  );
  await assert.rejects(
    () => awaitToolingProviderPreflight(ctx, { provider: failingProvider, inputs: failingInputs, waveToken: failingWaveToken }),
    /forced preflight failure/
  );
  assert.equal(rejectCount, 1);
  const failingSnapshot = readToolingProviderPreflightState(ctx, { provider: failingProvider, inputs: failingInputs });
  assert.equal(failingSnapshot?.state, 'failed');
  assert.equal(failingSnapshot?.diagnostic?.reasonCode, 'preflight_failed');

  let optionalFailOpenCount = 0;
  const optionalProvider = {
    id: 'optional-fail-open-provider',
    preflightId: 'optional-fail-open-provider.preflight',
    preflightPolicy: 'optional',
    getConfigHash() {
      return 'optional-fail-open-hash';
    },
    async preflight() {
      optionalFailOpenCount += 1;
      throw new Error('forced optional preflight failure');
    }
  };
  const optionalInputs = buildInputs('optional');
  const optionalResult = await awaitToolingProviderPreflight(ctx, {
    provider: optionalProvider,
    inputs: optionalInputs,
    waveToken: 'optional-wave'
  });
  assert.equal(optionalFailOpenCount, 1);
  assert.equal(optionalResult?.state, 'degraded');
  assert.equal(optionalResult?.blockProvider, false);
  const optionalSnapshot = readToolingProviderPreflightState(ctx, { provider: optionalProvider, inputs: optionalInputs });
  assert.equal(optionalSnapshot?.state, 'degraded');
  assert.equal(optionalSnapshot?.diagnostic?.reasonCode, 'preflight_failed');

  let noopRunCount = 0;
  const noopProvider = {
    id: 'noop-provider',
    preflightId: 'noop-provider.health-check',
    getConfigHash() {
      return 'noop-hash';
    },
    async preflight() {
      noopRunCount += 1;
      return { state: 'degraded', reasonCode: 'preflight_command_unavailable' };
    }
  };
  const noopInputs = buildInputs('noop');
  const noopResult = await awaitToolingProviderPreflight(ctx, { provider: noopProvider, inputs: noopInputs, waveToken: 'noop-wave' });
  assert.equal(noopRunCount, 1);
  assert.equal(noopResult?.state, 'degraded');
  const noopSnapshot = readToolingProviderPreflightState(ctx, { provider: noopProvider, inputs: noopInputs });
  assert.equal(noopSnapshot?.state, 'degraded');
  assert.equal(noopSnapshot?.diagnostic?.reasonCode, 'preflight_command_unavailable');
};

const runEnforcedTimeoutCase = async () => {
  let attempts = 0;
  const ctx = buildCtx();
  const provider = {
    id: 'enforced-timeout-fixture',
    preflightId: 'enforced-timeout-fixture.preflight',
    preflightTimeoutMs: 40,
    getConfigHash() {
      return 'enforced-timeout-fixture';
    },
    async preflight() {
      attempts += 1;
      return await new Promise(() => {});
    }
  };
  const inputs = buildInputs('enforced-timeout');
  await assert.rejects(
    () => awaitToolingProviderPreflight(ctx, { provider, inputs }),
    (error) => error?.code === 'TOOLING_PREFLIGHT_TIMEOUT'
  );
  await assert.rejects(
    () => awaitToolingProviderPreflight(ctx, { provider, inputs }),
    (error) => error?.code === 'TOOLING_PREFLIGHT_TIMEOUT'
  );
  assert.equal(attempts, 2);
};

const runTimeoutTieringCase = async () => {
  const captured = new Map();
  const createProvider = ({ id, preflightClass = null, preflightTimeoutMs = null }) => ({
    id,
    preflightId: `${id}.preflight`,
    ...(preflightClass ? { preflightClass } : {}),
    ...(Number.isFinite(preflightTimeoutMs) ? { preflightTimeoutMs } : {}),
    getConfigHash() {
      return `${id}-hash`;
    },
    async preflight(_ctx, inputs = {}) {
      captured.set(id, {
        preflightClass: String(inputs.preflightClass || ''),
        preflightTimeoutMs: Number(inputs.preflightTimeoutMs) || null
      });
      return { state: 'ready' };
    }
  });
  const ctx = buildCtx({
    toolingConfig: {
      preflight: {
        timeoutMs: 1111,
        timeoutMsByClass: {
          probe: 3210,
          workspace: 6543
        }
      }
    }
  });
  const sharedInputs = buildInputs('timeout-tiering');
  await awaitToolingProviderPreflight(ctx, { provider: createProvider({ id: 'probe-provider', preflightClass: 'probe' }), inputs: sharedInputs });
  await awaitToolingProviderPreflight(ctx, { provider: createProvider({ id: 'workspace-provider', preflightClass: 'workspace' }), inputs: sharedInputs });
  await awaitToolingProviderPreflight(ctx, { provider: createProvider({ id: 'dependency-provider', preflightClass: 'dependency' }), inputs: sharedInputs });
  await awaitToolingProviderPreflight(ctx, {
    provider: createProvider({ id: 'override-provider', preflightClass: 'workspace', preflightTimeoutMs: 7777 }),
    inputs: sharedInputs
  });
  assert.equal(captured.get('probe-provider')?.preflightClass, 'probe');
  assert.equal(captured.get('workspace-provider')?.preflightClass, 'workspace');
  assert.equal(captured.get('dependency-provider')?.preflightClass, 'dependency');
  assert.equal(captured.get('probe-provider')?.preflightTimeoutMs, 3210);
  assert.equal(captured.get('workspace-provider')?.preflightTimeoutMs, 6543);
  assert.equal(captured.get('dependency-provider')?.preflightTimeoutMs, 1111);
  assert.equal(captured.get('override-provider')?.preflightTimeoutMs, 7777);
};

const runTimeoutEventCase = async () => {
  const logs = [];
  const ctx = buildCtx({ logger: (line) => logs.push(String(line || '')) });
  const provider = {
    id: 'timeout-fixture',
    preflightId: 'timeout-fixture.preflight',
    getConfigHash() {
      return 'timeout-hash';
    },
    async preflight() {
      return { state: 'degraded', timeout: true, reasonCode: 'preflight_timeout' };
    }
  };
  const result = await awaitToolingProviderPreflight(ctx, { provider, inputs: buildInputs('timeout-event') });
  assert.equal(result?.state, 'degraded');
  assert.equal(result?.timedOut, true);
  assert.ok(logs.some((line) => line.includes('preflight:timeout provider=timeout-fixture')));
  assert.ok(logs.some((line) => line.includes('state=degraded')));
};

const runConcurrencySchedulerCase = async () => {
  const logs = [];
  const ctx = buildCtx({
    logger: (line) => logs.push(String(line || '')),
    toolingConfig: { preflight: { maxConcurrency: 1 } }
  });
  let runningCount = 0;
  let runningPeak = 0;
  const createProvider = (id) => ({
    id,
    preflightId: `${id}.workspace-model`,
    preflightClass: 'workspace',
    getConfigHash() {
      return `${id}-hash`;
    },
    async preflight() {
      runningCount += 1;
      runningPeak = Math.max(runningPeak, runningCount);
      await wait(40);
      runningCount = Math.max(0, runningCount - 1);
      return { state: 'ready' };
    }
  });
  const providerA = createProvider('preflight-a');
  const providerB = createProvider('preflight-b');
  const plans = [
    { provider: providerA, ...buildInputs('preflight-a') },
    { provider: providerB, ...buildInputs('preflight-b') }
  ];
  const waveToken = kickoffToolingProviderPreflights(ctx, plans);
  await Promise.all([
    awaitToolingProviderPreflight(ctx, { provider: providerA, inputs: plans[0], waveToken }),
    awaitToolingProviderPreflight(ctx, { provider: providerB, inputs: plans[1], waveToken })
  ]);
  assert.equal(runningPeak, 1);
  const metrics = getToolingProviderPreflightSchedulerMetrics(ctx);
  assert.equal(metrics.maxConcurrency, 1);
  assert.ok(metrics.queuedTotal >= 1);
  assert.ok(metrics.queueDepthPeak >= 1);
  assert.ok(metrics.queueWaitSamples >= 1);
  assert.ok(metrics.byClass?.workspace?.scheduled >= 2);
  assert.ok(metrics.byClass?.workspace?.started >= 2);
  assert.ok(metrics.byClass?.workspace?.completed >= 2);
  assert.ok(logs.some((line) => line.includes('preflight:queued provider=')));
  assert.ok(logs.some((line) => line.includes('preflight:dequeued provider=')));
};

const runRerunStateRefreshCase = async () => {
  const ctx = buildCtx();
  let invocationCount = 0;
  const provider = {
    id: 'rerun-snapshot-provider',
    preflightId: 'rerun-snapshot-provider.health-check',
    getConfigHash() {
      return 'rerun-snapshot-provider-hash';
    },
    async preflight() {
      invocationCount += 1;
      if (invocationCount === 1) {
        return { state: 'ready', reasonCode: null, message: '' };
      }
      throw new Error('forced rerun failure');
    }
  };
  const inputs = buildInputs('rerun-refresh');
  await awaitToolingProviderPreflight(ctx, { provider, inputs });
  const firstSnapshot = readToolingProviderPreflightState(ctx, { provider, inputs });
  assert.equal(firstSnapshot?.state, 'ready');
  await assert.rejects(() => awaitToolingProviderPreflight(ctx, { provider, inputs }), /forced rerun failure/);
  const secondSnapshot = readToolingProviderPreflightState(ctx, { provider, inputs });
  assert.equal(secondSnapshot?.state, 'failed');
  assert.equal(secondSnapshot?.diagnostic?.reasonCode, 'preflight_failed');
};

const runTeardownCases = async () => {
  const timeoutLogs = [];
  const timeoutCtx = buildCtx({ logger: (line) => timeoutLogs.push(String(line || '')) });
  const timeoutProvider = {
    id: 'teardown-fixture',
    preflightId: 'teardown-fixture.preflight',
    getConfigHash() {
      return 'teardown-hash';
    },
    async preflight() {
      await wait(120);
      return { state: 'ready' };
    }
  };
  kickoffToolingProviderPreflights(timeoutCtx, [{ provider: timeoutProvider, ...buildInputs('teardown-timeout') }]);
  const timedOut = await teardownToolingProviderPreflights(timeoutCtx, { timeoutMs: 10 });
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.total, 1);
  assert.ok(timeoutLogs.some((line) => line.includes('preflight:teardown_timeout')));
  assert.ok(timeoutLogs.some((line) => line.includes('teardown-fixture/teardown-fixture.preflight')));
  await wait(170);
  const settled = await teardownToolingProviderPreflights(timeoutCtx, { timeoutMs: 10 });
  assert.equal(settled.timedOut, false);
  assert.equal(settled.total, 0);

  const abortLogs = [];
  const abortCtx = buildCtx({ logger: (line) => abortLogs.push(String(line || '')) });
  const abortProvider = {
    id: 'teardown-abort-fixture',
    preflightId: 'teardown-abort-fixture.preflight',
    getConfigHash() {
      return 'teardown-abort-hash';
    },
    async preflight(_ctx, inputs = {}) {
      const signal = inputs?.abortSignal;
      return await new Promise((resolve) => {
        if (!signal || typeof signal.addEventListener !== 'function') {
          setTimeout(() => resolve({ state: 'ready' }), 5000);
          return;
        }
        if (signal.aborted) {
          resolve({ state: 'blocked', reasonCode: 'preflight_timeout', timedOut: true });
          return;
        }
        signal.addEventListener('abort', () => {
          resolve({ state: 'blocked', reasonCode: 'preflight_timeout', timedOut: true });
        }, { once: true });
      });
    }
  };
  kickoffToolingProviderPreflights(abortCtx, [{ provider: abortProvider, ...buildInputs('teardown-abort') }]);
  const aborted = await teardownToolingProviderPreflights(abortCtx, { timeoutMs: 10 });
  assert.equal(aborted.timedOut, true);
  assert.equal(aborted.total, 1);
  assert.equal(aborted.aborted >= 1, true);
  assert.ok(abortLogs.some((line) => line.includes('preflight:teardown_abort')));
  const drained = await teardownToolingProviderPreflights(abortCtx, { timeoutMs: 10 });
  assert.equal(drained.total, 0);
};

const runKickoffSkipEmptyCase = () => {
  const ctx = buildCtx();
  let runCount = 0;
  const provider = {
    id: 'kickoff-empty-fixture',
    preflightId: 'kickoff-empty-fixture.preflight',
    getConfigHash() {
      return 'kickoff-empty-hash';
    },
    async preflight() {
      runCount += 1;
      return { state: 'ready' };
    }
  };
  const waveToken = kickoffToolingProviderPreflights(ctx, [
    { provider, documents: [], targets: [] },
    { provider, documents: [{ virtualPath: 'src/file.fixture', languageId: 'fixture' }], targets: [] }
  ]);
  assert.equal(typeof waveToken, 'string');
  assert.equal(runCount, 0);
  assert.equal(listToolingProviderPreflightStates(ctx).length, 0);
};

runGuardCases();
runMetadataCoverageCase();
runCommandProfileHelperCase();
runContractCase();
await runSingleFlightCase();
await runEnforcedTimeoutCase();
await runTimeoutTieringCase();
await runTimeoutEventCase();
await runConcurrencySchedulerCase();
await runRerunStateRefreshCase();
await runTeardownCases();
runKickoffSkipEmptyCase();

console.log('LSP preflight contract matrix test passed');
