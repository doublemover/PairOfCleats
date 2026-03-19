#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../src/shared/cli.js';
import {
  MAX_JSON_BYTES,
  loadJsonObjectArtifactSync,
  loadPiecesManifest,
  resolveArtifactPresence
} from '../../src/shared/artifact-io.js';
import { hasIndexMeta } from '../../src/retrieval/cli/index-loader.js';
import { resolveIndexDir } from '../../src/retrieval/cli-index.js';
import { getCacheRoot, resolveRepoConfig } from '../shared/dict-utils.js';
import { getServiceConfigPath, loadServiceConfig } from '../service/config.js';
import {
  describeQueueBackpressure,
  describeQueueMetrics,
  quarantineSummary,
  queueSummary
} from '../service/queue.js';
import { inspectRepairState } from '../service/repair.js';

export const DIAGNOSTICS_REPORT_SCHEMA_VERSION = 1;
export const DIAGNOSTICS_REPORT_KIND = Object.freeze({
  ALL: 'all',
  RISK_COVERAGE: 'risk-coverage',
  CAP_HEAVY_RISK_PACKS: 'cap-heavy-risk-packs',
  QUEUE_HEALTH: 'queue-health',
  STALE_JOBS: 'stale-jobs'
});

const REPORT_TITLES = Object.freeze({
  [DIAGNOSTICS_REPORT_KIND.RISK_COVERAGE]: 'Risk Coverage Quality',
  [DIAGNOSTICS_REPORT_KIND.CAP_HEAVY_RISK_PACKS]: 'Cap-Heavy Risk Packs',
  [DIAGNOSTICS_REPORT_KIND.QUEUE_HEALTH]: 'Queue Health',
  [DIAGNOSTICS_REPORT_KIND.STALE_JOBS]: 'Stale Job Causes'
});

const STATUS_RANK = Object.freeze({
  ok: 0,
  warn: 1,
  error: 2
});

const uniq = (items) => Array.from(new Set((Array.isArray(items) ? items : []).filter(Boolean)));

const pushHint = (hints, value) => {
  if (typeof value !== 'string' || !value.trim()) return;
  hints.push(value.trim());
};

const pushReason = (reasonCodes, value) => {
  if (typeof value !== 'string' || !value.trim()) return;
  reasonCodes.push(value.trim());
};

const upgradeStatus = (current, next) => (
  (STATUS_RANK[next] || 0) > (STATUS_RANK[current] || 0) ? next : current
);

const toInt = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
};

const toDisplayQueueName = (value) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw || 'index';
};

const readJsonFile = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const createSection = (kind) => ({
  kind,
  title: REPORT_TITLES[kind] || kind,
  status: 'ok',
  reasonCodes: [],
  hints: [],
  summary: {},
  details: {}
});

const finalizeSection = (section) => ({
  ...section,
  reasonCodes: uniq(section.reasonCodes).sort((left, right) => left.localeCompare(right)),
  hints: uniq(section.hints)
});

const combineStatuses = (sections) => sections.reduce((status, section) => (
  upgradeStatus(status, section?.status || 'ok')
), 'ok');

const normalizeRequestedKinds = (value) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw === DIAGNOSTICS_REPORT_KIND.ALL) {
    return [DIAGNOSTICS_REPORT_KIND.ALL];
  }
  return uniq(raw.split(',').map((entry) => entry.trim().toLowerCase()));
};

const resolveSelectedKinds = (requestedKinds, input = {}) => {
  const requested = normalizeRequestedKinds(requestedKinds);
  if (!requested.includes(DIAGNOSTICS_REPORT_KIND.ALL)) return requested;
  const selected = [];
  if (input.repoRoot) selected.push(DIAGNOSTICS_REPORT_KIND.RISK_COVERAGE);
  if (input.contextPackPath) selected.push(DIAGNOSTICS_REPORT_KIND.CAP_HEAVY_RISK_PACKS);
  if (input.queueDir) {
    selected.push(DIAGNOSTICS_REPORT_KIND.QUEUE_HEALTH);
    selected.push(DIAGNOSTICS_REPORT_KIND.STALE_JOBS);
  }
  return uniq(selected);
};

const resolveQueueDirInput = ({ queueDir = null, configPath = null }) => {
  if (queueDir) return path.resolve(queueDir);
  const config = loadServiceConfig(getServiceConfigPath(configPath || null));
  return config.queueDir
    ? path.resolve(config.queueDir)
    : path.join(getCacheRoot(), 'service', 'queue');
};

const resolveArtifactStatus = (presence, { required = false } = {}) => {
  const missing = presence?.format === 'missing'
    || presence?.missingMeta === true
    || (Array.isArray(presence?.missingPaths) && presence.missingPaths.length > 0);
  if (missing) return required ? 'missing' : 'not_required';
  return 'present';
};

const loadRiskCoverageState = ({ repoRoot }) => {
  const { userConfig } = resolveRepoConfig(repoRoot);
  const indexDir = resolveIndexDir(repoRoot, 'code', userConfig);
  const riskArtifactsPresent = fs.existsSync(path.join(indexDir, 'risk_interprocedural_stats.json'))
    || fs.existsSync(path.join(indexDir, 'pieces', 'manifest.json'));
  const indexPresent = hasIndexMeta(indexDir) || riskArtifactsPresent;
  if (!indexPresent) {
    return {
      repoRoot,
      indexDir,
      indexPresent,
      manifest: null,
      stats: null,
      artifactStatus: null
    };
  }
  let manifest = null;
  try {
    manifest = loadPiecesManifest(indexDir, { strict: false, maxBytes: MAX_JSON_BYTES });
  } catch {}
  let stats = null;
  try {
    stats = loadJsonObjectArtifactSync(indexDir, 'risk_interprocedural_stats', {
      manifest,
      strict: false,
      maxBytes: MAX_JSON_BYTES
    });
  } catch {}
  const artifactStatus = {
    stats: resolveArtifactStatus(resolveArtifactPresence(indexDir, 'risk_interprocedural_stats', {
      manifest,
      strict: false
    }), { required: true }),
    summaries: resolveArtifactStatus(resolveArtifactPresence(indexDir, 'risk_summaries', {
      manifest,
      strict: false
    }), { required: true }),
    flows: resolveArtifactStatus(resolveArtifactPresence(indexDir, 'risk_flows', {
      manifest,
      strict: false
    }), {
      required: stats?.effectiveConfig?.summaryOnly !== true && stats?.status !== 'disabled'
    }),
    partialFlows: resolveArtifactStatus(resolveArtifactPresence(indexDir, 'risk_partial_flows', {
      manifest,
      strict: false
    }), { required: false }),
    callSites: resolveArtifactStatus(resolveArtifactPresence(indexDir, 'call_sites', {
      manifest,
      strict: false
    }), { required: false })
  };
  return {
    repoRoot,
    indexDir,
    indexPresent,
    manifest,
    stats,
    artifactStatus
  };
};

export function buildRiskCoverageReport({ repoRoot }) {
  const section = createSection(DIAGNOSTICS_REPORT_KIND.RISK_COVERAGE);
  const state = loadRiskCoverageState({ repoRoot });
  section.summary = {
    repoRoot: state.repoRoot,
    indexDir: state.indexDir
  };
  section.details = {
    artifactStatus: state.artifactStatus
  };
  if (!state.indexPresent) {
    section.status = 'error';
    pushReason(section.reasonCodes, 'RISK_COVERAGE_NO_INDEX');
    pushHint(section.hints, 'Build the code index before relying on risk coverage reports.');
    pushHint(section.hints, `Run: node build_index.js --repo "${state.repoRoot}"`);
    return finalizeSection(section);
  }
  if (!state.stats || typeof state.stats !== 'object') {
    section.status = 'error';
    pushReason(section.reasonCodes, 'RISK_COVERAGE_MISSING_STATS');
    pushHint(section.hints, 'Rebuild the risk artifacts so risk_interprocedural_stats.json is present and valid.');
    section.details.stats = null;
    return finalizeSection(section);
  }
  const flowsEmitted = toInt(state.stats?.counts?.flowsEmitted);
  const partialFlowsEmitted = toInt(state.stats?.counts?.partialFlowsEmitted);
  const uniqueCallSitesReferenced = toInt(state.stats?.counts?.uniqueCallSitesReferenced);
  const capsHit = uniq(state.stats?.capsHit);
  const riskStatus = String(state.stats?.status || 'unknown').trim().toLowerCase();
  const summaryOnly = state.stats?.effectiveConfig?.summaryOnly === true;
  section.summary = {
    ...section.summary,
    riskStatus,
    summaryOnly,
    flowsEmitted,
    partialFlowsEmitted,
    uniqueCallSitesReferenced,
    capsHit
  };
  section.details.stats = state.stats;
  if (riskStatus === 'disabled' || state.stats?.effectiveConfig?.enabled === false) {
    section.status = upgradeStatus(section.status, 'warn');
    pushReason(section.reasonCodes, 'RISK_COVERAGE_DISABLED');
    pushHint(section.hints, 'Enable interprocedural risk analysis before using this coverage signal.');
  }
  if (riskStatus === 'timed_out') {
    section.status = upgradeStatus(section.status, 'error');
    pushReason(section.reasonCodes, 'RISK_COVERAGE_TIMED_OUT');
    pushHint(section.hints, 'Stabilize risk artifact generation before trusting missing or partial coverage.');
  }
  if (riskStatus === 'schema_invalid') {
    section.status = upgradeStatus(section.status, 'error');
    pushReason(section.reasonCodes, 'RISK_COVERAGE_SCHEMA_INVALID');
    pushHint(section.hints, 'Repair or regenerate invalid risk artifacts; schema-invalid output should not be consumed.');
  }
  if (riskStatus === 'degraded') {
    section.status = upgradeStatus(section.status, 'warn');
    pushReason(section.reasonCodes, 'RISK_COVERAGE_DEGRADED');
    pushHint(section.hints, 'Investigate partial risk artifact availability before treating coverage as complete.');
  }
  if (summaryOnly) {
    section.status = upgradeStatus(section.status, 'warn');
    pushReason(section.reasonCodes, 'RISK_COVERAGE_SUMMARY_ONLY');
    pushHint(section.hints, 'Disable summary-only risk output when operators need concrete flow evidence.');
  }
  if (state.artifactStatus?.flows === 'missing' && !summaryOnly) {
    section.status = upgradeStatus(section.status, 'warn');
    pushReason(section.reasonCodes, 'RISK_COVERAGE_FLOWS_MISSING');
    pushHint(section.hints, 'Restore risk_flows artifact generation so coverage quality includes concrete flow evidence.');
  }
  if (flowsEmitted === 0 && !summaryOnly && riskStatus === 'ok') {
    section.status = upgradeStatus(section.status, 'warn');
    pushReason(section.reasonCodes, 'RISK_COVERAGE_ZERO_FLOWS');
    pushHint(section.hints, 'Review rule coverage and propagation depth if risk analysis consistently emits zero flows.');
  }
  if (flowsEmitted > 0 && uniqueCallSitesReferenced === 0) {
    section.status = upgradeStatus(section.status, 'warn');
    pushReason(section.reasonCodes, 'RISK_COVERAGE_CALL_SITES_MISSING');
    pushHint(section.hints, 'Preserve call_sites artifacts so emitted flows still have actionable evidence.');
  }
  if (capsHit.length > 0) {
    section.status = upgradeStatus(section.status, 'warn');
    pushReason(section.reasonCodes, 'RISK_COVERAGE_CAPPED');
    pushHint(section.hints, 'Reduce scope or raise risk artifact budgets only after confirming the larger output is still operator-usable.');
  }
  return finalizeSection(section);
}

const resolveContextPackPayload = (payload) => {
  if (payload?.risk && typeof payload.risk === 'object') return payload;
  if (payload?.result?.risk && typeof payload.result.risk === 'object') return payload.result;
  return null;
};

export function buildCapHeavyRiskPacksReport({ contextPackPath }) {
  const section = createSection(DIAGNOSTICS_REPORT_KIND.CAP_HEAVY_RISK_PACKS);
  const raw = readJsonFile(contextPackPath);
  const pack = resolveContextPackPayload(raw);
  section.summary = {
    contextPackPath: path.resolve(contextPackPath)
  };
  if (!pack?.risk || typeof pack.risk !== 'object') {
    section.status = 'error';
    pushReason(section.reasonCodes, 'RISK_PACK_INVALID_INPUT');
    pushHint(section.hints, 'Provide a context-pack JSON payload that includes a risk section.');
    return finalizeSection(section);
  }
  const capsHit = uniq(pack.risk?.caps?.hits);
  const truncation = Array.isArray(pack.risk?.truncation) ? pack.risk.truncation : [];
  const analysisCode = String(pack.risk?.analysisStatus?.code || pack.risk?.status || 'unknown').trim().toLowerCase();
  const observed = pack.risk?.caps?.observed && typeof pack.risk.caps.observed === 'object'
    ? pack.risk.caps.observed
    : {};
  const omittedFlows = toInt(observed.omittedFlows) + toInt(observed.omittedPartialFlows);
  section.summary = {
    ...section.summary,
    analysisCode,
    capsHit,
    truncationEntries: truncation.length,
    omittedFlows
  };
  section.details = {
    risk: pack.risk
  };
  if (analysisCode === 'missing' || analysisCode === 'schema_invalid' || analysisCode === 'timed_out') {
    section.status = 'error';
    pushReason(section.reasonCodes, 'RISK_PACK_NOT_ACTIONABLE');
    pushHint(section.hints, 'Regenerate the context pack after fixing the underlying risk artifact failure.');
  } else if (analysisCode === 'degraded') {
    section.status = 'warn';
    pushReason(section.reasonCodes, 'RISK_PACK_DEGRADED');
    pushHint(section.hints, 'Inspect missing artifact surfaces before trusting this context pack as complete evidence.');
  }
  if (analysisCode === 'capped' || capsHit.length > 0 || truncation.length > 0) {
    section.status = upgradeStatus(section.status, 'warn');
    pushReason(section.reasonCodes, 'RISK_PACK_CAPPED');
    pushHint(section.hints, 'Narrow the seed, lower hop fanout, or apply risk filters before increasing pack budgets.');
  }
  if (omittedFlows > 0) {
    pushReason(section.reasonCodes, 'RISK_PACK_FLOWS_DROPPED');
    pushHint(section.hints, 'Dropped flows indicate the pack is prioritizing boundedness over completeness; reduce scope before raising limits.');
  }
  if (capsHit.includes('maxCallSiteExcerptBytes') || capsHit.includes('maxCallSiteExcerptTokens')) {
    pushReason(section.reasonCodes, 'RISK_PACK_EVIDENCE_TRUNCATED');
    pushHint(section.hints, 'Preserve shorter call-site excerpts only if operators still get enough evidence to act.');
  }
  return finalizeSection(section);
}

const resolveQueueConfigs = ({ configPath, queueName = 'index' }) => {
  const config = loadServiceConfig(getServiceConfigPath(configPath || null));
  const normalizedQueueName = toDisplayQueueName(queueName);
  const isEmbeddingsQueue = normalizedQueueName === 'embeddings' || normalizedQueueName.startsWith('embeddings-');
  return {
    queueName: normalizedQueueName,
    queueConfig: isEmbeddingsQueue ? (config.embeddings?.queue || {}) : (config.queue || {}),
    workerConfig: isEmbeddingsQueue ? (config.embeddings?.worker || {}) : (config.worker || {})
  };
};

export async function buildQueueHealthReport({ queueDir, queueName = 'index', configPath = null }) {
  const section = createSection(DIAGNOSTICS_REPORT_KIND.QUEUE_HEALTH);
  const resolved = resolveQueueConfigs({ configPath, queueName });
  const [queue, quarantine, backpressure, metrics] = await Promise.all([
    queueSummary(queueDir, resolved.queueName),
    quarantineSummary(queueDir, resolved.queueName),
    describeQueueBackpressure(queueDir, resolved.queueName, {
      queueConfig: resolved.queueConfig,
      workerConfig: resolved.workerConfig
    }),
    describeQueueMetrics(queueDir, resolved.queueName, {
      queueConfig: resolved.queueConfig,
      workerConfig: resolved.workerConfig
    })
  ]);
  section.summary = {
    queueName: resolved.queueName,
    queue,
    quarantine,
    saturationState: metrics?.saturation?.state || 'normal',
    sloState: metrics?.saturation?.sloState || 'healthy'
  };
  section.details = {
    backpressure,
    metrics
  };
  if (metrics?.saturation?.state === 'saturated') {
    section.status = upgradeStatus(section.status, 'warn');
    pushReason(section.reasonCodes, 'QUEUE_HEALTH_SATURATED');
    pushHint(section.hints, 'Reduce queued work or raise queue budgets only if workers and downstream systems can absorb the extra load.');
  }
  if (metrics?.saturation?.sloState === 'degraded') {
    section.status = upgradeStatus(section.status, 'warn');
    pushReason(section.reasonCodes, 'QUEUE_HEALTH_SLO_DEGRADED');
    pushHint(section.hints, 'Treat degraded queue SLOs as early warning and stop adding heavy work until latency recovers.');
  }
  if (metrics?.saturation?.sloState === 'overloaded') {
    section.status = upgradeStatus(section.status, 'error');
    pushReason(section.reasonCodes, 'QUEUE_HEALTH_SLO_OVERLOADED');
    pushHint(section.hints, 'Hold new heavy work, drain backlog, and clear stale owners before changing queue limits.');
  }
  if (toInt(metrics?.leaseExpiry?.totalRecords) > 0) {
    section.status = upgradeStatus(section.status, 'warn');
    pushReason(section.reasonCodes, 'QUEUE_HEALTH_LEASE_EXPIRY_PRESENT');
    pushHint(section.hints, 'Lease-expiry records indicate work is timing out or orphaning; inspect stale-job causes before retrying quarantine blindly.');
  }
  const retryRate = Number(metrics?.retryRate?.value || 0);
  const retryThresholds = metrics?.retryRate?.thresholds || {};
  if (retryThresholds.overloaded != null && retryRate >= retryThresholds.overloaded) {
    section.status = upgradeStatus(section.status, 'error');
    pushReason(section.reasonCodes, 'QUEUE_HEALTH_RETRY_RATE_OVERLOADED');
    pushHint(section.hints, 'Retry rate has crossed the overloaded threshold; fix the failing workload instead of relying on queue retries.');
  } else if (retryThresholds.degraded != null && retryRate >= retryThresholds.degraded) {
    section.status = upgradeStatus(section.status, 'warn');
    pushReason(section.reasonCodes, 'QUEUE_HEALTH_RETRY_RATE_DEGRADED');
    pushHint(section.hints, 'Retry rate is creeping upward; isolate the dominant failure mode before it saturates the queue.');
  }
  return finalizeSection(section);
}

const buildStaleJobEntry = (entry, queueName) => {
  const remediation = [
    `Inspect: node tools/service/indexer-service.js inspect --queue ${queueName} --job ${entry.id} --json`
  ];
  let rootCauseCode = 'STALE_JOB_UNKNOWN';
  if (entry.status === 'orphaned') {
    rootCauseCode = 'STALE_JOB_OWNER_DEAD';
    remediation.push(`Quarantine if confirmed dead: node tools/service/indexer-service.js quarantine-job --queue ${queueName} --job ${entry.id} --reason orphaned-worker --json`);
  } else if (entry.status === 'stale') {
    rootCauseCode = 'STALE_JOB_LEASE_EXPIRED';
    remediation.push(`Retry after inspection: node tools/service/indexer-service.js retry --queue ${queueName} --job ${entry.id} --json`);
  } else if (entry.status === 'warning') {
    rootCauseCode = 'STALE_JOB_HEARTBEAT_LATE';
  }
  return {
    ...entry,
    rootCauseCode,
    remediation
  };
};

export async function buildStaleJobsReport({ queueDir, queueName = 'index' }) {
  const section = createSection(DIAGNOSTICS_REPORT_KIND.STALE_JOBS);
  const normalizedQueueName = toDisplayQueueName(queueName);
  const state = await inspectRepairState(queueDir, normalizedQueueName);
  const staleJobs = Array.isArray(state?.heartbeat?.jobs)
    ? state.heartbeat.jobs
      .filter((entry) => entry.status === 'stale' || entry.status === 'orphaned' || entry.status === 'warning')
      .map((entry) => buildStaleJobEntry(entry, normalizedQueueName))
    : [];
  section.summary = {
    queueName: normalizedQueueName,
    totalRunning: toInt(state?.heartbeat?.totalRunning),
    stale: staleJobs.filter((entry) => entry.status === 'stale').length,
    orphaned: staleJobs.filter((entry) => entry.status === 'orphaned').length,
    warning: staleJobs.filter((entry) => entry.status === 'warning').length
  };
  section.details = {
    jobs: staleJobs,
    locks: state?.locks || [],
    orphans: state?.orphans || { logs: [], reports: [] }
  };
  if (staleJobs.some((entry) => entry.status === 'stale')) {
    section.status = upgradeStatus(section.status, 'error');
    pushReason(section.reasonCodes, 'STALE_JOB_LEASE_EXPIRED');
    pushHint(section.hints, 'Lease-expired running jobs should be repaired before increasing retry budgets or queue capacity.');
  }
  if (staleJobs.some((entry) => entry.status === 'orphaned')) {
    section.status = upgradeStatus(section.status, 'error');
    pushReason(section.reasonCodes, 'STALE_JOB_OWNER_DEAD');
    pushHint(section.hints, 'Orphaned owners usually mean crashed workers or stale leases; clear them before resuming throughput tuning.');
  }
  if (staleJobs.some((entry) => entry.status === 'warning')) {
    section.status = upgradeStatus(section.status, 'warn');
    pushReason(section.reasonCodes, 'STALE_JOB_HEARTBEAT_LATE');
    pushHint(section.hints, 'Late heartbeats are an early warning that workers are approaching stale-job conditions.');
  }
  if (!staleJobs.length) {
    pushHint(section.hints, 'No stale-job signals are currently present.');
  }
  return finalizeSection(section);
}

export async function buildDiagnosticsReport(input = {}) {
  const queueDir = (input.queueDir || input.configPath)
    ? resolveQueueDirInput({ queueDir: input.queueDir, configPath: input.configPath })
    : null;
  const selectedKinds = resolveSelectedKinds(input.reportKinds, {
    ...input,
    queueDir
  });
  const sections = [];
  for (const kind of selectedKinds) {
    if (kind === DIAGNOSTICS_REPORT_KIND.RISK_COVERAGE) {
      sections.push(buildRiskCoverageReport({ repoRoot: input.repoRoot }));
      continue;
    }
    if (kind === DIAGNOSTICS_REPORT_KIND.CAP_HEAVY_RISK_PACKS) {
      sections.push(buildCapHeavyRiskPacksReport({ contextPackPath: input.contextPackPath }));
      continue;
    }
    if (kind === DIAGNOSTICS_REPORT_KIND.QUEUE_HEALTH) {
      sections.push(await buildQueueHealthReport({
        queueDir,
        queueName: input.queueName,
        configPath: input.configPath
      }));
      continue;
    }
    if (kind === DIAGNOSTICS_REPORT_KIND.STALE_JOBS) {
      sections.push(await buildStaleJobsReport({
        queueDir,
        queueName: input.queueName
      }));
    }
  }
  return {
    schemaVersion: DIAGNOSTICS_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    inputs: {
      repoRoot: input.repoRoot ? path.resolve(input.repoRoot) : null,
      contextPackPath: input.contextPackPath ? path.resolve(input.contextPackPath) : null,
      queueDir: queueDir ? path.resolve(queueDir) : null,
      queueName: input.queueName ? toDisplayQueueName(input.queueName) : null,
      configPath: input.configPath ? path.resolve(input.configPath) : null
    },
    summary: {
      status: combineStatuses(sections),
      reportCount: sections.length,
      warnings: sections.filter((entry) => entry.status === 'warn').length,
      errors: sections.filter((entry) => entry.status === 'error').length
    },
    reports: sections
  };
}

export function renderDiagnosticsReportHuman(report) {
  const lines = [
    `Diagnostics Report [${report?.summary?.status || 'ok'}]`,
    `Generated: ${report?.generatedAt || 'unknown'}`
  ];
  const inputs = report?.inputs || {};
  if (inputs.repoRoot) lines.push(`Repo: ${inputs.repoRoot}`);
  if (inputs.contextPackPath) lines.push(`Context Pack: ${inputs.contextPackPath}`);
  if (inputs.queueDir) lines.push(`Queue Dir: ${inputs.queueDir}`);
  if (inputs.queueName) lines.push(`Queue: ${inputs.queueName}`);
  for (const section of Array.isArray(report?.reports) ? report.reports : []) {
    lines.push('');
    lines.push(`${section.title} [${section.status}]`);
    if (Array.isArray(section.reasonCodes) && section.reasonCodes.length) {
      lines.push(`Reason Codes: ${section.reasonCodes.join(', ')}`);
    }
    const summaryEntries = Object.entries(section.summary || {});
    for (const [key, value] of summaryEntries) {
      if (value == null || typeof value === 'object') continue;
      lines.push(`${key}: ${String(value)}`);
    }
    if (section.kind === DIAGNOSTICS_REPORT_KIND.QUEUE_HEALTH) {
      lines.push(`queue: ${JSON.stringify(section.summary?.queue || {})}`);
      lines.push(`quarantine: ${JSON.stringify(section.summary?.quarantine || {})}`);
    }
    if (section.kind === DIAGNOSTICS_REPORT_KIND.STALE_JOBS) {
      const jobs = Array.isArray(section.details?.jobs) ? section.details.jobs : [];
      if (jobs.length) {
        for (const job of jobs) {
          lines.push(`job ${job.id}: ${job.status} (${job.rootCauseCode})`);
        }
      } else {
        lines.push('job status: no stale or warning jobs detected');
      }
    }
    if (Array.isArray(section.hints) && section.hints.length) {
      for (const hint of section.hints) {
        lines.push(`hint: ${hint}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

export async function runDiagnosticsReportCli(rawArgs = process.argv.slice(2)) {
  const argv = createCli({
    scriptName: 'diagnostics-report',
    options: {
      report: { type: 'string', default: 'all' },
      repo: { type: 'string' },
      'context-pack': { type: 'string' },
      'queue-dir': { type: 'string' },
      queue: { type: 'string', default: 'index' },
      config: { type: 'string' },
      json: { type: 'boolean', default: false },
      out: { type: 'string' }
    },
    argv: ['node', 'diagnostics-report', ...rawArgs]
  }).parse();

  const report = await buildDiagnosticsReport({
    reportKinds: argv.report,
    repoRoot: argv.repo || null,
    contextPackPath: argv['context-pack'] || null,
    queueDir: argv['queue-dir'] || null,
    queueName: argv.queue || 'index',
    configPath: argv.config || null
  });

  if (argv.out) {
    const outPath = path.resolve(argv.out);
    await fsPromises.mkdir(path.dirname(outPath), { recursive: true });
    await fsPromises.writeFile(outPath, JSON.stringify(report, null, 2));
  }

  if (argv.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(renderDiagnosticsReportHuman(report));
  }

  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDiagnosticsReportCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
