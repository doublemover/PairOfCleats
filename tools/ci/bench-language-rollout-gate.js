#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { emitGateResult } from '../shared/tooling-gate-utils.js';
import { readJsonFileResolved } from '../shared/json-utils.js';

const parseArgs = () => createCli({
  scriptName: 'pairofcleats bench-language-rollout-gate',
  options: {
    plan: { type: 'string', default: '' },
    json: { type: 'string', default: '' },
    enforce: { type: 'boolean', default: false }
  }
})
  .strictOptions()
  .parse();

const SORT_TEXT = (left, right) => String(left).localeCompare(String(right));

const normalizeText = (value) => String(value || '').trim();

const normalizeCountMap = (value) => Object.fromEntries(
  Object.entries(value && typeof value === 'object' && !Array.isArray(value) ? value : {})
    .map(([key, count]) => [key, Number(count)])
    .filter(([key, count]) => key && Number.isFinite(count))
    .sort(([left], [right]) => SORT_TEXT(left, right))
);

const resolvePlanPath = (planPath, relativePath) => {
  const raw = normalizeText(relativePath);
  if (!raw) return '';
  if (path.isAbsolute(raw)) return path.resolve(raw);
  return path.resolve(path.dirname(planPath), raw);
};

const toFiniteOrNull = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const buildDeltaMap = (beforeMap, afterMap) => {
  const keys = new Set([
    ...Object.keys(beforeMap || {}),
    ...Object.keys(afterMap || {})
  ]);
  return Object.fromEntries(
    Array.from(keys)
      .sort(SORT_TEXT)
      .map((key) => [
        key,
        (Number(afterMap?.[key]) || 0) - (Number(beforeMap?.[key]) || 0)
      ])
  );
};

const loadBenchReportSummary = async (reportPath) => {
  const payload = await readJsonFileResolved(reportPath);
  const run = payload?.run && typeof payload.run === 'object' ? payload.run : {};
  const overallSummary = payload?.overallSummary && typeof payload.overallSummary === 'object'
    ? payload.overallSummary
    : {};
  const buildMs = overallSummary?.buildMs && typeof overallSummary.buildMs === 'object'
    ? overallSummary.buildMs
    : {};
  return {
    path: reportPath,
    generatedAt: normalizeText(payload?.generatedAt) || null,
    aggregateResultClass: normalizeText(run?.aggregateResultClass) || null,
    repoCounts: {
      total: Number(run?.repoCounts?.total) || 0,
      failed: Number(run?.repoCounts?.failed) || 0,
      passed: Number(run?.repoCounts?.passed) || 0,
      passedWithDegradation: Number(run?.repoCounts?.passedWithDegradation) || 0,
      skipped: Number(run?.repoCounts?.skipped) || 0
    },
    retainedCrashBundleCount: Number(payload?.diagnostics?.crashRetention?.retainedCount) || 0,
    countsByResultClass: normalizeCountMap(run?.countsByResultClass),
    countsByDiagnosticType: normalizeCountMap(run?.countsByDiagnosticType),
    coreTiming: {
      buildIndexMsAvg: toFiniteOrNull(buildMs?.index),
      buildSqliteMsAvg: toFiniteOrNull(buildMs?.sqlite),
      queryWallMsPerSearch: toFiniteOrNull(overallSummary?.queryWallMsPerSearch)
    }
  };
};

const buildComparisonArtifact = async (planPath, payload, scopeLabel) => {
  const beforeReportPath = resolvePlanPath(planPath, payload?.beforeReport);
  const afterReportPath = resolvePlanPath(planPath, payload?.afterReport);
  if (!beforeReportPath || !afterReportPath) {
    throw new Error(`${scopeLabel} requires beforeReport and afterReport`);
  }
  const before = await loadBenchReportSummary(beforeReportPath);
  const after = await loadBenchReportSummary(afterReportPath);
  return {
    before,
    after,
    delta: {
      failedRepoCount: after.repoCounts.failed - before.repoCounts.failed,
      retainedCrashBundleCount: after.retainedCrashBundleCount - before.retainedCrashBundleCount,
      coreTiming: {
        buildIndexMsAvg: toFiniteOrNull(after.coreTiming.buildIndexMsAvg) != null && toFiniteOrNull(before.coreTiming.buildIndexMsAvg) != null
          ? Number((after.coreTiming.buildIndexMsAvg - before.coreTiming.buildIndexMsAvg).toFixed(3))
          : null,
        buildSqliteMsAvg: toFiniteOrNull(after.coreTiming.buildSqliteMsAvg) != null && toFiniteOrNull(before.coreTiming.buildSqliteMsAvg) != null
          ? Number((after.coreTiming.buildSqliteMsAvg - before.coreTiming.buildSqliteMsAvg).toFixed(3))
          : null,
        queryWallMsPerSearch: toFiniteOrNull(after.coreTiming.queryWallMsPerSearch) != null && toFiniteOrNull(before.coreTiming.queryWallMsPerSearch) != null
          ? Number((after.coreTiming.queryWallMsPerSearch - before.coreTiming.queryWallMsPerSearch).toFixed(3))
          : null
      },
      countsByResultClass: buildDeltaMap(before.countsByResultClass, after.countsByResultClass),
      countsByDiagnosticType: buildDeltaMap(before.countsByDiagnosticType, after.countsByDiagnosticType)
    }
  };
};

const validateReproduction = (area, failures) => {
  const reproduction = area?.reproduction;
  if (!reproduction || typeof reproduction !== 'object' || Array.isArray(reproduction)) {
    failures.push('missing reproduction/replay definition');
    return null;
  }
  const id = normalizeText(reproduction.id);
  const kind = normalizeText(reproduction.kind);
  const evidence = [
    normalizeText(reproduction.command),
    normalizeText(reproduction.test),
    normalizeText(reproduction.artifact),
    normalizeText(reproduction.description)
  ].filter(Boolean);
  if (!id) failures.push('reproduction id is required');
  if (!kind) failures.push('reproduction kind is required');
  if (!evidence.length) failures.push('reproduction must include command, test, artifact, or description');
  return {
    id: id || null,
    kind: kind || null,
    command: normalizeText(reproduction.command) || null,
    test: normalizeText(reproduction.test) || null,
    artifact: normalizeText(reproduction.artifact) || null,
    description: normalizeText(reproduction.description) || null
  };
};

const validateContracts = (area, failures) => {
  const contracts = Array.isArray(area?.contracts) ? area.contracts : [];
  if (!contracts.length) {
    failures.push('at least one focused contract test is required');
    return [];
  }
  return contracts.map((entry, index) => {
    const id = normalizeText(entry?.id) || `contract-${index + 1}`;
    const kind = normalizeText(entry?.kind);
    const evidence = [
      normalizeText(entry?.test),
      normalizeText(entry?.command),
      normalizeText(entry?.artifact)
    ].filter(Boolean);
    if (!kind) failures.push(`contract ${id} is missing kind`);
    if (!evidence.length) failures.push(`contract ${id} must include test, command, or artifact`);
    return {
      id,
      kind: kind || null,
      test: normalizeText(entry?.test) || null,
      command: normalizeText(entry?.command) || null,
      artifact: normalizeText(entry?.artifact) || null
    };
  });
};

const validateTemporaryPolicySwitches = (area, failures) => {
  const switches = Array.isArray(area?.temporaryPolicySwitches) ? area.temporaryPolicySwitches : [];
  return switches.map((entry, index) => {
    const id = normalizeText(entry?.id) || `temporary-policy-${index + 1}`;
    if (entry?.validationOnly !== true) {
      failures.push(`temporary policy switch ${id} must be validationOnly=true`);
    }
    if (entry?.removed !== true) {
      failures.push(`temporary policy switch ${id} must be removed before closeout`);
    }
    return {
      id,
      validationOnly: entry?.validationOnly === true,
      removed: entry?.removed === true,
      note: normalizeText(entry?.note) || null
    };
  });
};

const validateCutover = (area, failures) => {
  const cutover = area?.cutover;
  if (!cutover || typeof cutover !== 'object' || Array.isArray(cutover)) {
    failures.push('cutover details are required');
    return {
      hardCutover: false,
      compatibilityPathsRemoved: false,
      note: null
    };
  }
  if (cutover.hardCutover !== true) {
    failures.push('cutover must record hardCutover=true');
  }
  if (cutover.compatibilityPathsRemoved !== true) {
    failures.push('cutover must record compatibilityPathsRemoved=true');
  }
  return {
    hardCutover: cutover.hardCutover === true,
    compatibilityPathsRemoved: cutover.compatibilityPathsRemoved === true,
    note: normalizeText(cutover.note) || null
  };
};

const validateFixArea = async (planPath, area, index) => {
  const failures = [];
  const id = normalizeText(area?.id) || `fix-area-${index + 1}`;
  const title = normalizeText(area?.title);
  const owner = normalizeText(area?.owner);
  if (!title) failures.push('title is required');
  if (!owner) failures.push('owner is required');
  const reproduction = validateReproduction(area, failures);
  const contracts = validateContracts(area, failures);
  let controlSlice = null;
  try {
    controlSlice = await buildComparisonArtifact(planPath, area?.controlSlice, 'controlSlice');
  } catch (error) {
    failures.push(`controlSlice ${error?.message || String(error)}`);
  }
  let fullCorpus = null;
  try {
    fullCorpus = await buildComparisonArtifact(planPath, area?.fullCorpus, 'fullCorpus');
  } catch (error) {
    failures.push(`fullCorpus ${error?.message || String(error)}`);
  }
  const temporaryPolicySwitches = validateTemporaryPolicySwitches(area, failures);
  const cutover = validateCutover(area, failures);
  return {
    id,
    title: title || null,
    owner: owner || null,
    reproduction,
    contracts,
    controlSlice,
    fullCorpus,
    temporaryPolicySwitches,
    cutover,
    failures
  };
};

const main = async () => {
  const argv = parseArgs();
  const planPath = path.resolve(normalizeText(argv.plan));
  if (!normalizeText(argv.plan)) {
    throw new Error('--plan is required');
  }
  const payload = await readJsonFileResolved(planPath);
  const fixAreas = Array.isArray(payload?.fixAreas) ? payload.fixAreas : [];
  if (!fixAreas.length) {
    throw new Error('rollout plan must include at least one fix area');
  }

  const areas = [];
  const failures = [];
  for (let index = 0; index < fixAreas.length; index += 1) {
    const area = await validateFixArea(planPath, fixAreas[index], index);
    areas.push(area);
    for (const failure of area.failures) {
      failures.push({
        areaId: area.id,
        message: failure
      });
    }
  }

  const enforce = argv.enforce === true;
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: failures.length ? (enforce ? 'error' : 'warn') : 'ok',
    enforced: enforce,
    planPath,
    rollout: {
      id: normalizeText(payload?.id) || path.basename(planPath, path.extname(planPath)),
      title: normalizeText(payload?.title) || null,
      description: normalizeText(payload?.description) || null,
      fixAreaCount: areas.length
    },
    ownerMatrixDoc: 'docs/perf/bench-language-rollout-discipline.md',
    areas,
    failures
  };

  await emitGateResult({
    jsonPath: argv.json,
    payload: output,
    heading: 'bench-language rollout gate',
    summaryLines: [
      `- status: ${output.status}`,
      `- plan: ${output.rollout.id}`,
      `- fixAreas: ${areas.length}`,
      `- failures: ${failures.length}`
    ],
    failures,
    renderFailure: (failure) => `${failure.areaId}: ${failure.message}`,
    enforceFailureExit: enforce
  });
};

main().catch((error) => {
  console.error(`bench-language rollout gate failed: ${error?.message || String(error)}`);
  process.exit(1);
});
