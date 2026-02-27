#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { getToolingConfig, resolveRepoConfig } from '../shared/dict-utils.js';
import { registerDefaultToolingProviders } from '../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../src/index/tooling/doctor.js';
import { resolveScmConfig } from '../../src/index/scm/registry.js';
import { readJsonFileResolvedSafe } from '../shared/json-utils.js';
import { emitGateResult, mapProvidersById, normalizeProviderId } from '../shared/tooling-gate-utils.js';

const TOOLING_DOCTOR_REPORT_FILENAME = 'tooling_doctor_report.json';

const parseArgs = () => createCli({
  scriptName: 'pairofcleats tooling-doctor-gate',
  options: {
    mode: { type: 'string', default: 'ci', choices: ['ci', 'nightly'] },
    repo: { type: 'string', default: '' },
    json: { type: 'string', default: '' },
    'probe-handshake': { type: 'boolean', default: true },
    'handshake-timeout-ms': { type: 'number', default: 4000 },
    'require-provider': { type: 'string', array: true, default: [] }
  }
})
  .strictOptions()
  .parse();

/**
 * Collect deterministic gate failures from a tooling doctor report.
 *
 * @param {object} report
 * @param {{requiredProviders:string[], reportPath:string}} options
 * @returns {Array<{code:string,message:string,provider?:string}>}
 */
const collectGateFailures = (report, options = {}) => {
  const failures = [];
  const requiredProviders = Array.isArray(options.requiredProviders) ? options.requiredProviders : [];
  const reportPath = String(options.reportPath || '').trim();

  if (!report || typeof report !== 'object') {
    failures.push({
      code: 'REPORT_INVALID',
      message: 'tooling doctor report is missing or invalid JSON.'
    });
    return failures;
  }

  if (report.schemaVersion !== 2) {
    failures.push({
      code: 'REPORT_SCHEMA_MISMATCH',
      message: `expected schemaVersion=2, received ${String(report.schemaVersion)}.`
    });
  }
  if (report.reportFile !== TOOLING_DOCTOR_REPORT_FILENAME) {
    failures.push({
      code: 'REPORT_FILE_MISMATCH',
      message: `expected reportFile=${TOOLING_DOCTOR_REPORT_FILENAME}.`
    });
  }
  if (path.basename(reportPath) !== TOOLING_DOCTOR_REPORT_FILENAME) {
    failures.push({
      code: 'REPORT_PATH_MISMATCH',
      message: `expected report path basename ${TOOLING_DOCTOR_REPORT_FILENAME}.`
    });
  }

  const summaryErrors = Number(report?.summary?.errors);
  if (Number.isFinite(summaryErrors) && summaryErrors > 0) {
    failures.push({
      code: 'DOCTOR_ERRORS',
      message: `tooling doctor reported ${summaryErrors} error(s).`
    });
  }

  if (!report?.identity?.chunkUid?.available) {
    failures.push({
      code: 'CHUNKUID_UNAVAILABLE',
      message: 'chunkUid backend unavailable in tooling doctor report.'
    });
  }

  const providers = Array.isArray(report.providers) ? report.providers : [];
  const providersById = mapProvidersById(providers);

  for (const provider of providers) {
    if (!provider?.enabled) continue;
    if (provider.status === 'error') {
      failures.push({
        code: 'ENABLED_PROVIDER_ERROR',
        provider: String(provider.id || ''),
        message: `enabled provider ${String(provider.id || '')} has error status.`
      });
    }
  }

  for (const providerId of requiredProviders) {
    const provider = providersById.get(providerId);
    if (!provider) {
      failures.push({
        code: 'REQUIRED_PROVIDER_MISSING',
        provider: providerId,
        message: `required provider ${providerId} missing from report.`
      });
      continue;
    }
    if (!provider.enabled) {
      failures.push({
        code: 'REQUIRED_PROVIDER_DISABLED',
        provider: providerId,
        message: `required provider ${providerId} is disabled.`
      });
    }
    if (!provider.available || provider.status === 'error') {
      failures.push({
        code: 'REQUIRED_PROVIDER_UNAVAILABLE',
        provider: providerId,
        message: `required provider ${providerId} is unavailable (${provider.status || 'unknown'}).`
      });
    }
    if (provider.command && provider.command?.probe?.ok === false) {
      failures.push({
        code: 'REQUIRED_PROVIDER_COMMAND_PROBE_FAILED',
        provider: providerId,
        message: `required provider ${providerId} command probe failed.`
      });
    }
    if (provider.handshake && provider.handshake?.ok === false) {
      failures.push({
        code: 'REQUIRED_PROVIDER_HANDSHAKE_FAILED',
        provider: providerId,
        message: `required provider ${providerId} initialize handshake failed.`
      });
    }
  }

  return failures;
};

const main = async () => {
  const argv = parseArgs();
  const mode = argv.mode;
  const requiredProviders = argv['require-provider']
    .map(normalizeProviderId)
    .filter(Boolean);
  const { repoRoot, userConfig } = resolveRepoConfig(argv.repo || null);
  const toolingConfig = getToolingConfig(repoRoot, userConfig);
  const scmConfig = resolveScmConfig({
    indexingConfig: userConfig.indexing || {},
    analysisPolicy: userConfig.analysisPolicy || null
  });
  registerDefaultToolingProviders();

  await runToolingDoctor({
    repoRoot,
    buildRoot: repoRoot,
    toolingConfig,
    scmConfig,
    strict: false
  }, null, {
    log: () => {},
    probeHandshake: argv['probe-handshake'] !== false,
    handshakeTimeoutMs: argv['handshake-timeout-ms']
  });

  const reportPath = path.join(repoRoot, TOOLING_DOCTOR_REPORT_FILENAME);
  const report = await readJsonFileResolvedSafe(reportPath, null);
  const failures = collectGateFailures(report, { requiredProviders, reportPath });
  const gatePayload = {
    mode,
    generatedAt: new Date().toISOString(),
    status: failures.length ? 'error' : 'ok',
    reportPath,
    requiredProviders,
    summary: {
      status: report?.summary?.status || 'unknown',
      errors: Number(report?.summary?.errors) || 0,
      warnings: Number(report?.summary?.warnings) || 0
    },
    failures
  };

  await emitGateResult({
    jsonPath: argv.json,
    payload: gatePayload,
    heading: `Tooling doctor gate (${mode})`,
    summaryLines: [
      `- report: ${reportPath}`,
      `- summary: ${report?.summary?.status || 'unknown'} `
        + `(errors=${Number(report?.summary?.errors) || 0}, warnings=${Number(report?.summary?.warnings) || 0})`,
      `- gate: ${failures.length ? `failed (${failures.length})` : 'ok'}`
    ],
    failures,
    renderFailure: (failure) => {
      const providerLabel = failure?.provider ? ` [${failure.provider}]` : '';
      return `${failure?.code || 'UNKNOWN'}${providerLabel}: ${failure?.message || ''}`;
    }
  });
};

main().catch((error) => {
  console.error(`tooling doctor gate failed: ${error?.message || String(error)}`);
  process.exit(1);
});
