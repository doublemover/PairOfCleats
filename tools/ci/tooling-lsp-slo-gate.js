#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import {
  coerceClampedFraction,
  coerceFiniteNumber,
  coerceNumberAtLeast,
  coercePositiveInt
} from '../../src/shared/number-coerce.js';
import {
  readJsonFileResolved,
  writeJsonFileResolved
} from '../shared/json-utils.js';
import { resolveRepoConfig } from '../shared/dict-utils.js';

const parseArgs = () => createCli({
  scriptName: 'pairofcleats tooling-lsp-slo-gate',
  options: {
    mode: { type: 'string', default: 'ci', choices: ['ci', 'nightly'] },
    repo: { type: 'string', default: '' },
    doctor: { type: 'string', default: '' },
    json: { type: 'string', default: '' },
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
  const index = Math.min(sorted.length - 1, Math.floor(clampedRatio * (sorted.length - 1)));
  return sorted[index];
};

const buildProviderSamples = (doctorReport) => {
  const providers = Array.isArray(doctorReport?.providers) ? doctorReport.providers : [];
  const rows = [];
  for (const provider of providers) {
    if (provider?.enabled !== true) continue;
    const handshake = provider?.handshake && typeof provider.handshake === 'object'
      ? provider.handshake
      : null;
    if (!handshake) continue;
    const latencyMs = coerceNumberAtLeast(handshake.latencyMs, 0);
    rows.push({
      providerId: String(provider.id || '').trim().toLowerCase(),
      languages: Array.isArray(provider.languages) ? provider.languages.slice() : [],
      status: handshake.ok === true ? 'ok' : 'error',
      available: provider.available !== false,
      latencyMs: latencyMs ?? 0,
      timedOut: isTimeoutLikeError(handshake),
      errorCode: handshake.ok === true ? null : (handshake.errorCode || null),
      errorMessage: handshake.ok === true ? null : (handshake.errorMessage || null)
    });
  }
  return rows;
};

const resolveDoctorReportInput = async (doctorPath) => {
  const inputPath = path.resolve(String(doctorPath || ''));
  const payload = await readJsonFileResolved(inputPath);
  if (payload && Array.isArray(payload.providers)) {
    return {
      report: payload,
      reportPath: inputPath,
      inputPath
    };
  }
  const reportPathRaw = String(payload?.reportPath || '').trim();
  if (!reportPathRaw) {
    throw new Error(
      `doctor input missing providers/reportPath: ${inputPath}`
    );
  }
  const reportPath = path.isAbsolute(reportPathRaw)
    ? reportPathRaw
    : path.resolve(path.dirname(inputPath), reportPathRaw);
  const report = await readJsonFileResolved(reportPath);
  if (!report || !Array.isArray(report.providers)) {
    throw new Error(
      `resolved doctor report missing providers: ${reportPath}`
    );
  }
  return {
    report,
    reportPath: path.resolve(reportPath),
    inputPath
  };
};

const main = async () => {
  const argv = parseArgs();
  const { repoRoot } = resolveRepoConfig(argv.repo || null);
  const doctorInputPath = argv.doctor
    ? path.resolve(argv.doctor)
    : path.join(repoRoot, 'tooling_doctor_report.json');
  const doctorInput = await resolveDoctorReportInput(doctorInputPath);
  const doctorReport = doctorInput.report;
  const doctorPath = doctorInput.reportPath;
  const samples = buildProviderSamples(doctorReport);

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

  const failures = [];
  if (requests < thresholds.minProviderSamples) {
    failures.push(`provider samples ${requests} below min ${thresholds.minProviderSamples}`);
  }
  if (timeoutRatio > thresholds.timeoutRatioMax) {
    failures.push(`timeout ratio ${timeoutRatio.toFixed(4)} exceeded max ${thresholds.timeoutRatioMax.toFixed(4)}`);
  }
  if (fatalFailureRate > thresholds.fatalFailureRateMax) {
    failures.push(`fatal failure rate ${fatalFailureRate.toFixed(4)} exceeded max ${thresholds.fatalFailureRateMax.toFixed(4)}`);
  }
  if (enrichmentCoverage < thresholds.minEnrichmentCoverage) {
    failures.push(`enrichment coverage ${enrichmentCoverage.toFixed(4)} below min ${thresholds.minEnrichmentCoverage.toFixed(4)}`);
  }
  if (maxP95MsObserved > thresholds.maxP95Ms) {
    failures.push(`max p95 ${maxP95MsObserved.toFixed(2)}ms exceeded ${thresholds.maxP95Ms.toFixed(2)}ms`);
  }

  const payload = {
    schemaVersion: 2,
    mode: argv.mode,
    generatedAt: new Date().toISOString(),
    status: failures.length ? 'error' : 'ok',
    doctorInputPath: doctorInput.inputPath,
    doctorPath,
    sampleCount: requests,
    thresholds,
    metrics: {
      requests,
      timedOut,
      timeoutRatio,
      fatalFailures,
      fatalFailureRate,
      enrichedSamples,
      enrichmentCoverage,
      maxP95Ms: maxP95MsObserved
    },
    samples,
    failures
  };

  await writeJsonFileResolved(argv.json, payload, { trailingNewline: true });
  console.error(`Tooling LSP SLO gate (${argv.mode})`);
  console.error(`- status: ${payload.status}`);
  console.error(`- providerSamples: ${requests}`);
  console.error(`- timeoutRatio: ${timeoutRatio.toFixed(4)} (max ${thresholds.timeoutRatioMax.toFixed(4)})`);
  console.error(`- fatalFailureRate: ${fatalFailureRate.toFixed(4)} (max ${thresholds.fatalFailureRateMax.toFixed(4)})`);
  console.error(`- enrichmentCoverage: ${enrichmentCoverage.toFixed(4)} (min ${thresholds.minEnrichmentCoverage.toFixed(4)})`);
  console.error(`- maxP95Ms: ${maxP95MsObserved.toFixed(2)} (max ${thresholds.maxP95Ms.toFixed(2)})`);
  if (failures.length) {
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(3);
  }
};

main().catch((error) => {
  console.error(`tooling lsp slo gate failed: ${error?.message || String(error)}`);
  process.exit(1);
});
