#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import {
  coerceClampedFraction,
  coerceFiniteNumber,
  coerceNumberAtLeast,
  coercePositiveInt
} from '../../src/shared/number-coerce.js';
import { probeLspInitializeHandshake } from '../../src/index/tooling/command-resolver.js';
import { resolveRepoConfig } from '../shared/dict-utils.js';
import { emitGateResult, normalizeProviderId, resolveDoctorReportInput } from '../shared/tooling-gate-utils.js';

const DEFAULT_SAMPLES_PER_PROVIDER = 2;
const DEFAULT_WARMUP_SAMPLES = 1;
const DEFAULT_PROBE_TIMEOUT_MS = 5000;
const RUST_PROBE_WORKSPACE = path.join('.testLogs', 'tooling-lsp-probe-workspaces', 'rust');

const parseArgs = () => createCli({
  scriptName: 'pairofcleats tooling-lsp-slo-gate',
  options: {
    mode: { type: 'string', default: 'ci', choices: ['ci', 'nightly'] },
    repo: { type: 'string', default: '' },
    doctor: { type: 'string', default: '' },
    json: { type: 'string', default: '' },
    enforce: { type: 'boolean', default: false },
    'samples-per-provider': { type: 'number', default: DEFAULT_SAMPLES_PER_PROVIDER },
    'warmup-samples': { type: 'number', default: DEFAULT_WARMUP_SAMPLES },
    'probe-timeout-ms': { type: 'number', default: DEFAULT_PROBE_TIMEOUT_MS },
    'timeout-ratio-max': { type: 'number', default: 0.01 },
    'fatal-failure-rate-max': { type: 'number', default: 0 },
    'min-enrichment-coverage': { type: 'number', default: 1 },
    'max-p95-ms': { type: 'number', default: 1000 },
    'min-provider-samples': { type: 'number', default: 3 }
  }
})
  .strictOptions()
  .parse();

const isTimeoutLikeError = (handshake) => {
  if (!handshake || typeof handshake !== 'object') return false;
  const code = String(handshake.errorCode || '').toUpperCase();
  const message = String(handshake.errorMessage || '').toLowerCase();
  return code.includes('TIMEOUT')
    || message.includes('timed out')
    || message.includes('timeout');
};

const percentile = (values, ratio) => {
  if (!Array.isArray(values) || !values.length) return 0;
  const sorted = values
    .map((value) => coerceNumberAtLeast(value, 0))
    .filter((value) => value != null)
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const clampedRatio = Math.max(0, Math.min(1, coerceFiniteNumber(ratio, 1) ?? 1));
  // Use nearest-rank percentile to preserve tail sensitivity on small samples.
  // Example: n=3, p95 => index=2 (max), not index=1.
  const rank = Math.ceil(clampedRatio * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
};

const resolveWarmupSamples = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_WARMUP_SAMPLES;
  return Math.max(0, Math.floor(parsed));
};

const toStringArray = (value) => (
  Array.isArray(value) ? value.map((entry) => String(entry)) : []
);

const ensureRustProbeWorkspace = async (repoRoot) => {
  const workspaceRoot = path.join(repoRoot, RUST_PROBE_WORKSPACE);
  const srcDir = path.join(workspaceRoot, 'src');
  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(
    path.join(workspaceRoot, 'Cargo.toml'),
    '[package]\nname = "poc_lsp_probe"\nversion = "0.1.0"\nedition = "2021"\n',
    'utf8'
  );
  await fs.writeFile(path.join(srcDir, 'main.rs'), 'fn main() {}\n', 'utf8');
  return workspaceRoot;
};

const resolveProbeWorkspace = async (providerId, repoRoot) => {
  if (normalizeProviderId(providerId) === 'rust-analyzer') {
    return ensureRustProbeWorkspace(repoRoot);
  }
  return repoRoot;
};

const createSampleFromHandshake = (provider, handshake) => {
  const latencyMs = coerceNumberAtLeast(handshake.latencyMs, 0);
  return {
    providerId: normalizeProviderId(provider.id),
    languages: Array.isArray(provider.languages) ? provider.languages.slice() : [],
    status: handshake.ok === true ? 'ok' : 'error',
    available: provider.available !== false,
    latencyMs: latencyMs ?? 0,
    timedOut: isTimeoutLikeError(handshake),
    errorCode: handshake.ok === true ? null : (handshake.errorCode || null),
    errorMessage: handshake.ok === true ? null : (handshake.errorMessage || null),
    sampled: {
      mode: 'doctor-report',
      attemptCount: 1,
      warmupCount: 0,
      successCount: handshake.ok === true ? 1 : 0,
      failureCount: handshake.ok === true ? 0 : 1,
      probeWorkspace: null
    }
  };
};

const probeProviderSamples = async ({
  provider,
  providerId,
  cmd,
  args,
  repoRoot,
  samplesPerProvider,
  warmupSamples,
  probeTimeoutMs
}) => {
  const probeWorkspace = await resolveProbeWorkspace(providerId, repoRoot);
  for (let i = 0; i < warmupSamples; i += 1) {
    await probeLspInitializeHandshake({
      providerId,
      cmd,
      args,
      cwd: probeWorkspace,
      timeoutMs: probeTimeoutMs
    });
  }

  const attempts = [];
  for (let i = 0; i < samplesPerProvider; i += 1) {
    attempts.push(await probeLspInitializeHandshake({
      providerId,
      cmd,
      args,
      cwd: probeWorkspace,
      timeoutMs: probeTimeoutMs
    }));
  }
  const successfulAttempts = attempts.filter((attempt) => attempt?.ok === true);
  const status = successfulAttempts.length > 0 ? 'ok' : 'error';
  const latencySource = successfulAttempts.length > 0 ? successfulAttempts : attempts;
  const latencyMs = percentile(
    latencySource.map((attempt) => coerceNumberAtLeast(attempt?.latencyMs, 0) ?? 0),
    0.95
  );
  const timedOut = attempts.some((attempt) => isTimeoutLikeError(attempt));
  const lastFailure = attempts.findLast((attempt) => attempt?.ok !== true) || null;

  return {
    providerId,
    languages: Array.isArray(provider.languages) ? provider.languages.slice() : [],
    status,
    available: provider.available !== false,
    latencyMs,
    timedOut,
    errorCode: status === 'ok' ? null : (lastFailure?.errorCode || null),
    errorMessage: status === 'ok' ? null : (lastFailure?.errorMessage || 'initialize handshake failed'),
    sampled: {
      mode: 'live-probe',
      attemptCount: attempts.length,
      warmupCount: warmupSamples,
      successCount: successfulAttempts.length,
      failureCount: Math.max(0, attempts.length - successfulAttempts.length),
      probeWorkspace
    }
  };
};

const buildProviderSamples = async ({
  doctorReport,
  repoRoot,
  samplesPerProvider,
  warmupSamples,
  probeTimeoutMs
}) => {
  const providers = Array.isArray(doctorReport?.providers) ? doctorReport.providers : [];
  const rows = [];
  for (const provider of providers) {
    if (provider?.enabled !== true) continue;
    const providerId = normalizeProviderId(provider.id);
    if (!providerId) continue;
    const handshake = provider?.handshake && typeof provider.handshake === 'object'
      ? provider.handshake
      : null;
    const resolvedCommand = provider?.command?.resolved && typeof provider.command.resolved === 'object'
      ? provider.command.resolved
      : null;
    const resolvedCmd = String(resolvedCommand?.cmd || '').trim();
    const resolvedArgs = toStringArray(resolvedCommand?.args);
    if (resolvedCmd) {
      rows.push(await probeProviderSamples({
        provider,
        providerId,
        cmd: resolvedCmd,
        args: resolvedArgs,
        repoRoot,
        samplesPerProvider,
        warmupSamples,
        probeTimeoutMs
      }));
      continue;
    }
    if (handshake) {
      rows.push(createSampleFromHandshake(provider, handshake));
    }
  }
  return rows;
};

const main = async () => {
  const argv = parseArgs();
  const enforce = argv.enforce === true;
  const samplesPerProvider = coercePositiveInt(argv['samples-per-provider']) ?? DEFAULT_SAMPLES_PER_PROVIDER;
  const warmupSamples = resolveWarmupSamples(argv['warmup-samples']);
  const probeTimeoutMs = coerceNumberAtLeast(argv['probe-timeout-ms'], 750) ?? DEFAULT_PROBE_TIMEOUT_MS;
  const { repoRoot } = resolveRepoConfig(argv.repo || null);
  const doctorInputPath = argv.doctor
    ? path.resolve(argv.doctor)
    : path.join(repoRoot, 'tooling_doctor_report.json');
  const doctorInput = await resolveDoctorReportInput(doctorInputPath);
  const doctorReport = doctorInput.report;
  const doctorPath = doctorInput.reportPath;
  const samples = await buildProviderSamples({
    doctorReport,
    repoRoot,
    samplesPerProvider,
    warmupSamples,
    probeTimeoutMs
  });

  const thresholds = {
    timeoutRatioMax: coerceNumberAtLeast(argv['timeout-ratio-max'], 0) ?? 0.01,
    fatalFailureRateMax: coerceNumberAtLeast(argv['fatal-failure-rate-max'], 0) ?? 0,
    minEnrichmentCoverage: coerceClampedFraction(argv['min-enrichment-coverage'], {
      min: 0,
      max: 1,
      allowZero: true
    }) ?? 1,
    maxP95Ms: coerceNumberAtLeast(argv['max-p95-ms'], 1) ?? 1000,
    minProviderSamples: coercePositiveInt(argv['min-provider-samples']) ?? 3
  };

  const requests = samples.length;
  const measuredAttempts = samples.reduce(
    (total, sample) => total + (coerceNumberAtLeast(sample?.sampled?.attemptCount, 0) ?? 0),
    0
  );
  const measuredWarmups = samples.reduce(
    (total, sample) => total + (coerceNumberAtLeast(sample?.sampled?.warmupCount, 0) ?? 0),
    0
  );
  const timedOut = samples.filter((sample) => sample.timedOut).length;
  const fatalFailures = samples.filter((sample) => sample.status !== 'ok').length;
  const enrichedSamples = samples.filter((sample) => sample.status === 'ok' && sample.available).length;
  const successfulLatencyMs = samples
    .filter((sample) => sample.status === 'ok')
    .map((sample) => sample.latencyMs);
  const timeoutRatio = requests > 0 ? (timedOut / requests) : 0;
  const fatalFailureRate = requests > 0 ? (fatalFailures / requests) : 0;
  const enrichmentCoverage = requests > 0 ? (enrichedSamples / requests) : 0;
  const maxP95MsObserved = percentile(successfulLatencyMs, 0.95);

  const violations = [];
  if (requests < thresholds.minProviderSamples) {
    violations.push(`provider samples ${requests} below min ${thresholds.minProviderSamples}`);
  }
  if (timeoutRatio > thresholds.timeoutRatioMax) {
    violations.push(`timeout ratio ${timeoutRatio.toFixed(4)} exceeded max ${thresholds.timeoutRatioMax.toFixed(4)}`);
  }
  if (fatalFailureRate > thresholds.fatalFailureRateMax) {
    violations.push(`fatal failure rate ${fatalFailureRate.toFixed(4)} exceeded max ${thresholds.fatalFailureRateMax.toFixed(4)}`);
  }
  if (enrichmentCoverage < thresholds.minEnrichmentCoverage) {
    violations.push(`enrichment coverage ${enrichmentCoverage.toFixed(4)} below min ${thresholds.minEnrichmentCoverage.toFixed(4)}`);
  }
  if (maxP95MsObserved > thresholds.maxP95Ms) {
    violations.push(`max p95 ${maxP95MsObserved.toFixed(2)}ms exceeded ${thresholds.maxP95Ms.toFixed(2)}ms`);
  }

  const status = violations.length > 0
    ? (enforce ? 'error' : 'warn')
    : 'ok';

  const payload = {
    schemaVersion: 3,
    mode: argv.mode,
    generatedAt: new Date().toISOString(),
    status,
    enforced: enforce,
    doctorInputPath: doctorInput.inputPath,
    doctorPath,
    sampleCount: requests,
    thresholds,
    collection: {
      samplesPerProvider,
      warmupSamples,
      probeTimeoutMs
    },
    metrics: {
      requests,
      measuredAttempts,
      measuredWarmups,
      timedOut,
      timeoutRatio,
      fatalFailures,
      fatalFailureRate,
      enrichedSamples,
      enrichmentCoverage,
      maxP95Ms: maxP95MsObserved
    },
    samples,
    failures: violations
  };

  await emitGateResult({
    jsonPath: argv.json,
    payload,
    heading: `Tooling LSP SLO gate (${argv.mode})`,
    summaryLines: [
      `- status: ${payload.status}`,
      `- enforce: ${enforce ? 'on' : 'off (informational)'}`,
      `- providerSamples: ${requests}`,
      `- measuredAttempts: ${measuredAttempts} (warmups=${measuredWarmups})`,
      `- timeoutRatio: ${timeoutRatio.toFixed(4)} (max ${thresholds.timeoutRatioMax.toFixed(4)})`,
      `- fatalFailureRate: ${fatalFailureRate.toFixed(4)} (max ${thresholds.fatalFailureRateMax.toFixed(4)})`,
      `- enrichmentCoverage: ${enrichmentCoverage.toFixed(4)} (min ${thresholds.minEnrichmentCoverage.toFixed(4)})`,
      `- maxP95Ms: ${maxP95MsObserved.toFixed(2)} (max ${thresholds.maxP95Ms.toFixed(2)})`
    ],
    failures: violations,
    enforceFailureExit: enforce
  });
};

main().catch((error) => {
  console.error(`tooling lsp slo gate failed: ${error?.message || String(error)}`);
  process.exit(1);
});
