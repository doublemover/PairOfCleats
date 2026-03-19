import { resolveLanguageFamily } from '../query-generator.js';

export const BENCH_REUSE_SCHEMA_VERSION = 1;
export const BENCH_OWNERSHIP_SCHEMA_VERSION = 1;
export const BENCH_OWNERSHIP_POLICY_VERSION = 'bench-language-family-ownership-v1';
export const BENCH_OWNERSHIP_DIFF_SCHEMA_VERSION = 1;

const MEMORY_BACKENDS = new Set(['memory']);
const SQLITE_BACKENDS = new Set(['sqlite', 'sqlite-fts', 'fts']);
const OWNERSHIP_TOP_REPO_LIMIT = 5;
const DOMINANT_PHASE_KEYS = Object.freeze([
  'scan',
  'scheduler',
  'artifactCloseout',
  'sqlite',
  'tooling'
]);
const DEFAULT_FAMILY_BUDGET = Object.freeze({
  reuse: {
    coldStartMin: 0.4,
    intraRunMin: 0.82,
    crossRunMin: 0.7
  },
  rss: {
    sqliteAvgMbMax: 1536
  },
  throughput: {
    buildIndexMsAvgMax: 240000,
    artifactTailStallPerRepoMax: 1,
    queueDelayHotspotPerRepoMax: 0.5
  },
  phaseShare: {
    scanMaxShare: 0.7,
    schedulerMaxShare: 0.18,
    artifactCloseoutMaxShare: 0.25,
    sqliteMaxShare: 0.4,
    toolingMaxShare: 0.2
  }
});
const FAMILY_BUDGET_OVERRIDES = Object.freeze({
  clike: {
    rss: { sqliteAvgMbMax: 1792 },
    throughput: { buildIndexMsAvgMax: 260000 }
  },
  data: {
    reuse: { coldStartMin: 0.42, intraRunMin: 0.83, crossRunMin: 0.72 },
    rss: { sqliteAvgMbMax: 1664 },
    throughput: { buildIndexMsAvgMax: 260000 }
  },
  jvm: {
    reuse: { coldStartMin: 0.35, intraRunMin: 0.78, crossRunMin: 0.68 },
    rss: { sqliteAvgMbMax: 2304 },
    throughput: { buildIndexMsAvgMax: 320000 },
    phaseShare: { sqliteMaxShare: 0.45 }
  },
  scripting: {
    reuse: { coldStartMin: 0.45, intraRunMin: 0.85, crossRunMin: 0.74 },
    rss: { sqliteAvgMbMax: 1280 },
    throughput: { buildIndexMsAvgMax: 180000 }
  },
  systems: {
    reuse: { coldStartMin: 0.38, intraRunMin: 0.8, crossRunMin: 0.7 },
    rss: { sqliteAvgMbMax: 2048 },
    throughput: { buildIndexMsAvgMax: 300000 },
    phaseShare: { artifactCloseoutMaxShare: 0.3 }
  }
});

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const roundValue = (value, digits = 4) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(digits));
};

const average = (values) => {
  const numeric = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter(Number.isFinite);
  if (!numeric.length) return null;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
};

const sumValues = (values) => (
  (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0)
);

const compareNullableAscending = (left, right) => {
  const l = toFiniteNumber(left);
  const r = toFiniteNumber(right);
  if (l == null && r == null) return 0;
  if (l == null) return 1;
  if (r == null) return -1;
  return l - r;
};

const compareNullableDescending = (left, right) => {
  const l = toFiniteNumber(left);
  const r = toFiniteNumber(right);
  if (l == null && r == null) return 0;
  if (l == null) return 1;
  if (r == null) return -1;
  return r - l;
};

const pushOrderedLimited = (rows, entry, limit, compare) => {
  const list = Array.isArray(rows) ? rows : [];
  let insertAt = list.length;
  while (insertAt > 0 && compare(entry, list[insertAt - 1]) < 0) {
    insertAt -= 1;
  }
  if (list.length < limit) {
    list.splice(insertAt, 0, entry);
    return;
  }
  if (insertAt >= limit) return;
  list.splice(insertAt, 0, entry);
  list.length = limit;
};

const buildDelta = (beforeValue, afterValue, digits = 6) => {
  const before = toFiniteNumber(beforeValue);
  const after = toFiniteNumber(afterValue);
  if (before == null && after == null) return null;
  return {
    before,
    after,
    delta: before != null && after != null
      ? Number((after - before).toFixed(digits))
      : null
  };
};

const resolveGuardrailStatus = ({ actual = null, min = null, max = null } = {}) => {
  const value = toFiniteNumber(actual);
  if (value == null) return 'not_applicable';
  if (Number.isFinite(Number(min)) && value < Number(min)) return 'breached';
  if (Number.isFinite(Number(max)) && value > Number(max)) return 'breached';
  return 'within_budget';
};

const buildGuardrail = ({
  label,
  actual = null,
  min = null,
  max = null,
  unit = null
} = {}) => {
  const status = resolveGuardrailStatus({ actual, min, max });
  return {
    label,
    status,
    actual: roundValue(actual, unit === 'ratio' ? 4 : 2),
    min: roundValue(min, unit === 'ratio' ? 4 : 2),
    max: roundValue(max, unit === 'ratio' ? 4 : 2),
    unit
  };
};

const resolveLanguageFamilyForTask = (entry) => (
  resolveLanguageFamily({ languages: [entry?.language] }) || 'general'
);

const isBackendIncluded = (backend, allowed) => allowed.has(String(backend || '').trim().toLowerCase());

const collectHitRatesForSummary = (summary, predicate) => {
  const out = [];
  if (!summary || typeof summary !== 'object') return out;
  const backends = summary.backends || Object.keys(summary.hitRate || {});
  for (const backend of Array.isArray(backends) ? backends : []) {
    if (typeof predicate === 'function' && !predicate(backend)) continue;
    const value = toFiniteNumber(summary?.hitRate?.[backend]);
    if (value != null) out.push({ backend, value });
  }
  return out;
};

const summarizeReuseLane = (rows, { label, backendSet = null, modeGate = null } = {}) => {
  const applicableRows = rows.filter((entry) => {
    if (typeof modeGate === 'function' && !modeGate(entry)) return false;
    return true;
  });
  const hits = [];
  const backendHits = new Map();
  const worstRepos = [];
  for (const entry of applicableRows) {
    const candidates = collectHitRatesForSummary(entry?.summary, (backend) => (
      backendSet ? isBackendIncluded(backend, backendSet) : true
    ));
    const values = candidates.map((candidate) => candidate.value).filter(Number.isFinite);
    const repoValue = average(values);
    for (const candidate of candidates) {
      if (!backendHits.has(candidate.backend)) backendHits.set(candidate.backend, []);
      backendHits.get(candidate.backend).push(candidate.value);
      hits.push(candidate.value);
    }
    if (repoValue != null) {
      pushOrderedLimited(worstRepos, {
        language: entry.language,
        tier: entry.tier,
        repo: entry.repo,
        hitRate: roundValue(repoValue, 4)
      }, OWNERSHIP_TOP_REPO_LIMIT, (left, right) => (
        compareNullableAscending(left.hitRate, right.hitRate)
      ) || String(left.repo).localeCompare(String(right.repo)));
    }
  }
  return {
    label,
    repoCount: applicableRows.length,
    backendAverages: Object.fromEntries(
      Array.from(backendHits.entries())
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([backend, values]) => [backend, roundValue(average(values), 4)])
    ),
    averageHitRate: roundValue(average(hits), 4),
    worstRepos
  };
};

export const buildBenchReuseFromSummary = ({
  summary = null,
  methodology = null
} = {}) => {
  const shellEntry = { summary };
  const mode = String(methodology?.mode || '').trim().toLowerCase() || 'warm';
  return {
    schemaVersion: BENCH_REUSE_SCHEMA_VERSION,
    mode,
    coldStart: summarizeReuseLane([shellEntry], {
      label: 'cold-start',
      modeGate: () => mode === 'cold'
    }),
    intraRun: summarizeReuseLane([shellEntry], {
      label: 'intra-run',
      backendSet: MEMORY_BACKENDS
    }),
    crossRun: summarizeReuseLane([shellEntry], {
      label: 'cross-run',
      backendSet: SQLITE_BACKENDS
    }),
    overall: summarizeReuseLane([shellEntry], { label: 'overall' })
  };
};

export const buildBenchReuseSummary = ({
  tasks = [],
  methodology = null
} = {}) => {
  const mode = String(methodology?.mode || '').trim().toLowerCase() || 'warm';
  return {
    schemaVersion: BENCH_REUSE_SCHEMA_VERSION,
    mode,
    coldStart: summarizeReuseLane(tasks, {
      label: 'cold-start',
      modeGate: () => mode === 'cold'
    }),
    intraRun: summarizeReuseLane(tasks, {
      label: 'intra-run',
      backendSet: MEMORY_BACKENDS
    }),
    crossRun: summarizeReuseLane(tasks, {
      label: 'cross-run',
      backendSet: SQLITE_BACKENDS
    }),
    overall: summarizeReuseLane(tasks, { label: 'overall' })
  };
};

const countByDiagnosticType = (entry, type) => {
  const direct = Number(entry?.diagnostics?.process?.countsByType?.[type]);
  if (Number.isFinite(direct)) return direct;
  const nested = Number(entry?.diagnostics?.countsByType?.[type]);
  return Number.isFinite(nested) ? nested : 0;
};

const resolveTaskPhaseSummary = (entry, methodology = null) => {
  const stages = entry?.stageTimingProfile?.stages || {};
  const queueDelayMs = toFiniteNumber(entry?.stageTimingProfile?.watchdog?.queueDelayMs?.summary?.totalMs) || 0;
  const toolingMs = methodology?.toolingMode === 'included'
    ? (toFiniteNumber(entry?.summary?.buildMs?.tooling) || 0)
    : 0;
  const phaseDurations = {
    scan: sumValues([
      stages.discovery,
      stages.importScan,
      stages.scmMeta,
      stages.parseChunk,
      stages.inference,
      stages.embedding
    ]),
    scheduler: queueDelayMs,
    artifactCloseout: sumValues([stages.artifactWrite]),
    sqlite: sumValues([stages.sqliteBuild]),
    tooling: toolingMs
  };
  let totalObservedMs = sumValues(Object.values(phaseDurations));
  if (totalObservedMs <= 0) {
    if (countByDiagnosticType(entry, 'artifact_tail_stall') > 0) {
      phaseDurations.artifactCloseout = 1;
      totalObservedMs = 1;
    } else if (countByDiagnosticType(entry, 'queue_delay_hotspot') > 0) {
      phaseDurations.scheduler = 1;
      totalObservedMs = 1;
    }
  }
  const ranked = Object.entries(phaseDurations)
    .sort((left, right) => (right[1] - left[1]) || left[0].localeCompare(right[0]));
  const dominant = ranked.find(([, value]) => value > 0) || null;
  const dominantPhase = dominant?.[0] || null;
  const dominantShare = dominantPhase && totalObservedMs > 0
    ? dominant[1] / totalObservedMs
    : null;
  return {
    totalObservedMs: roundValue(totalObservedMs, 2),
    phaseDurations: Object.fromEntries(
      Object.entries(phaseDurations).map(([key, value]) => [key, roundValue(value, 2) || 0])
    ),
    dominantPhase,
    dominantShare: roundValue(dominantShare, 4)
  };
};

const mergeBudget = (family) => {
  const override = FAMILY_BUDGET_OVERRIDES[family] || null;
  if (!override) return JSON.parse(JSON.stringify(DEFAULT_FAMILY_BUDGET));
  return {
    reuse: {
      ...DEFAULT_FAMILY_BUDGET.reuse,
      ...(override.reuse || {})
    },
    rss: {
      ...DEFAULT_FAMILY_BUDGET.rss,
      ...(override.rss || {})
    },
    throughput: {
      ...DEFAULT_FAMILY_BUDGET.throughput,
      ...(override.throughput || {})
    },
    phaseShare: {
      ...DEFAULT_FAMILY_BUDGET.phaseShare,
      ...(override.phaseShare || {})
    }
  };
};

const buildOffenderIssues = (repoSummary, budget) => {
  const issues = [];
  if (repoSummary.reuse.intraRunHitRate != null && repoSummary.reuse.intraRunHitRate < budget.reuse.intraRunMin) {
    issues.push('intra_run_reuse');
  }
  if (repoSummary.reuse.crossRunHitRate != null && repoSummary.reuse.crossRunHitRate < budget.reuse.crossRunMin) {
    issues.push('cross_run_reuse');
  }
  if (repoSummary.reuse.coldStartHitRate != null && repoSummary.reuse.coldStartHitRate < budget.reuse.coldStartMin) {
    issues.push('cold_start_reuse');
  }
  if (repoSummary.sqliteRssMb != null && repoSummary.sqliteRssMb > budget.rss.sqliteAvgMbMax) {
    issues.push('sqlite_rss');
  }
  if (repoSummary.buildIndexMs != null && repoSummary.buildIndexMs > budget.throughput.buildIndexMsAvgMax) {
    issues.push('build_index');
  }
  if ((repoSummary.artifactTailStallCount || 0) > budget.throughput.artifactTailStallPerRepoMax) {
    issues.push('artifact_tail_stall');
  }
  if ((repoSummary.queueDelayHotspotCount || 0) > budget.throughput.queueDelayHotspotPerRepoMax) {
    issues.push('queue_delay_hotspot');
  }
  const dominantPhase = repoSummary.phase.dominantPhase;
  if (dominantPhase) {
    const maxShare = budget.phaseShare[`${dominantPhase}MaxShare`];
    if (repoSummary.phase.dominantShare != null && repoSummary.phase.dominantShare > maxShare) {
      issues.push(`dominant_phase:${dominantPhase}`);
    }
  }
  return issues;
};

const buildTaskHotspotRow = (entry, methodology, budget) => {
  const intraRunValues = collectHitRatesForSummary(entry?.summary, (backend) => isBackendIncluded(backend, MEMORY_BACKENDS))
    .map((candidate) => candidate.value);
  const crossRunValues = collectHitRatesForSummary(entry?.summary, (backend) => isBackendIncluded(backend, SQLITE_BACKENDS))
    .map((candidate) => candidate.value);
  const coldStartValues = String(methodology?.mode || '').trim().toLowerCase() === 'cold'
    ? collectHitRatesForSummary(entry?.summary).map((candidate) => candidate.value)
    : [];
  const sqliteRssValues = ['sqlite', 'sqlite-fts', 'fts']
    .map((backend) => entry?.summary?.memoryRss?.[backend]?.mean)
    .map(toFiniteNumber)
    .filter(Number.isFinite)
    .map((value) => value / (1024 * 1024));
  const phase = resolveTaskPhaseSummary(entry, methodology);
  const repoSummary = {
    language: entry.language,
    tier: entry.tier,
    repo: entry.repo,
    repoPath: entry.repoPath || null,
    reuse: {
      intraRunHitRate: roundValue(average(intraRunValues), 4),
      crossRunHitRate: roundValue(average(crossRunValues), 4),
      coldStartHitRate: roundValue(average(coldStartValues), 4)
    },
    sqliteRssMb: roundValue(average(sqliteRssValues), 2),
    buildIndexMs: roundValue(entry?.summary?.buildMs?.index, 2),
    artifactTailStallCount: countByDiagnosticType(entry, 'artifact_tail_stall'),
    queueDelayHotspotCount: countByDiagnosticType(entry, 'queue_delay_hotspot'),
    degradationCount: Array.isArray(entry?.taskStatus?.degradationClasses)
      ? entry.taskStatus.degradationClasses.length
      : 0,
    resultClass: entry?.taskStatus?.resultClass || null,
    phase
  };
  return {
    ...repoSummary,
    issues: buildOffenderIssues(repoSummary, budget)
  };
};

const buildFamilySummary = (family, rows, methodology) => {
  const budget = mergeBudget(family);
  const languages = [...new Set(rows.map((entry) => entry.language).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const reuse = {
    coldStart: {
      averageHitRate: roundValue(average(rows.map((entry) => entry.reuse.coldStartHitRate)), 4),
      guardrail: buildGuardrail({
        label: 'cold-start reuse',
        actual: average(rows.map((entry) => entry.reuse.coldStartHitRate)),
        min: budget.reuse.coldStartMin,
        unit: 'ratio'
      })
    },
    intraRun: {
      averageHitRate: roundValue(average(rows.map((entry) => entry.reuse.intraRunHitRate)), 4),
      guardrail: buildGuardrail({
        label: 'intra-run reuse',
        actual: average(rows.map((entry) => entry.reuse.intraRunHitRate)),
        min: budget.reuse.intraRunMin,
        unit: 'ratio'
      })
    },
    crossRun: {
      averageHitRate: roundValue(average(rows.map((entry) => entry.reuse.crossRunHitRate)), 4),
      guardrail: buildGuardrail({
        label: 'cross-run reuse',
        actual: average(rows.map((entry) => entry.reuse.crossRunHitRate)),
        min: budget.reuse.crossRunMin,
        unit: 'ratio'
      })
    }
  };
  const sqliteRssMb = average(rows.map((entry) => entry.sqliteRssMb));
  const buildIndexMsAvg = average(rows.map((entry) => entry.buildIndexMs));
  const artifactTailStallPerRepo = rows.length
    ? rows.reduce((sum, entry) => sum + (Number(entry.artifactTailStallCount) || 0), 0) / rows.length
    : null;
  const queueDelayHotspotPerRepo = rows.length
    ? rows.reduce((sum, entry) => sum + (Number(entry.queueDelayHotspotCount) || 0), 0) / rows.length
    : null;
  const phaseCounts = Object.fromEntries(DOMINANT_PHASE_KEYS.map((key) => [key, 0]));
  const phaseShares = Object.fromEntries(DOMINANT_PHASE_KEYS.map((key) => [key, []]));
  for (const entry of rows) {
    const dominantPhase = entry.phase.dominantPhase;
    if (!dominantPhase || !Object.prototype.hasOwnProperty.call(phaseCounts, dominantPhase)) continue;
    phaseCounts[dominantPhase] += 1;
    if (entry.phase.dominantShare != null) phaseShares[dominantPhase].push(entry.phase.dominantShare);
  }
  const dominantPhase = Object.entries(phaseCounts)
    .sort((left, right) => (right[1] - left[1])
      || (average(phaseShares[right[0]]) || 0) - (average(phaseShares[left[0]]) || 0)
      || left[0].localeCompare(right[0]))[0]?.[1] > 0
    ? Object.entries(phaseCounts)
      .sort((left, right) => (right[1] - left[1])
        || (average(phaseShares[right[0]]) || 0) - (average(phaseShares[left[0]]) || 0)
        || left[0].localeCompare(right[0]))[0][0]
    : null;
  const dominantPhaseShare = dominantPhase ? average(phaseShares[dominantPhase]) : null;
  const dominantPhaseBudget = dominantPhase ? budget.phaseShare[`${dominantPhase}MaxShare`] : null;
  const guardrails = [
    reuse.coldStart.guardrail,
    reuse.intraRun.guardrail,
    reuse.crossRun.guardrail,
    buildGuardrail({
      label: 'sqlite RSS',
      actual: sqliteRssMb,
      max: budget.rss.sqliteAvgMbMax,
      unit: 'mb'
    }),
    buildGuardrail({
      label: 'build index',
      actual: buildIndexMsAvg,
      max: budget.throughput.buildIndexMsAvgMax,
      unit: 'ms'
    }),
    buildGuardrail({
      label: 'artifact closeout stalls per repo',
      actual: artifactTailStallPerRepo,
      max: budget.throughput.artifactTailStallPerRepoMax,
      unit: 'count'
    }),
    buildGuardrail({
      label: 'scheduler queue-delay hotspots per repo',
      actual: queueDelayHotspotPerRepo,
      max: budget.throughput.queueDelayHotspotPerRepoMax,
      unit: 'count'
    }),
    buildGuardrail({
      label: dominantPhase ? `${dominantPhase} phase share` : 'dominant phase share',
      actual: dominantPhaseShare,
      max: dominantPhaseBudget,
      unit: 'ratio'
    })
  ];
  const activeGuardrails = guardrails.filter((entry) => entry.status !== 'not_applicable');
  const breachedGuardrails = activeGuardrails.filter((entry) => entry.status === 'breached');
  const topOffenders = [];
  for (const entry of rows) {
    const severity = entry.issues.length
      + Math.max(0, ((entry.buildIndexMs || 0) - budget.throughput.buildIndexMsAvgMax) / Math.max(1, budget.throughput.buildIndexMsAvgMax))
      + Math.max(0, ((entry.sqliteRssMb || 0) - budget.rss.sqliteAvgMbMax) / Math.max(1, budget.rss.sqliteAvgMbMax))
      + Math.max(0, ((budget.reuse.intraRunMin - (entry.reuse.intraRunHitRate || budget.reuse.intraRunMin)) / Math.max(0.01, budget.reuse.intraRunMin)))
      + Math.max(0, ((budget.reuse.crossRunMin - (entry.reuse.crossRunHitRate || budget.reuse.crossRunMin)) / Math.max(0.01, budget.reuse.crossRunMin)));
    pushOrderedLimited(topOffenders, {
      language: entry.language,
      tier: entry.tier,
      repo: entry.repo,
      repoPath: entry.repoPath,
      issues: entry.issues,
      severity: roundValue(severity, 3),
      buildIndexMs: entry.buildIndexMs,
      sqliteRssMb: entry.sqliteRssMb,
      intraRunHitRate: entry.reuse.intraRunHitRate,
      crossRunHitRate: entry.reuse.crossRunHitRate,
      coldStartHitRate: entry.reuse.coldStartHitRate,
      artifactTailStallCount: entry.artifactTailStallCount,
      queueDelayHotspotCount: entry.queueDelayHotspotCount,
      dominantPhase: entry.phase.dominantPhase,
      dominantPhaseShare: entry.phase.dominantShare,
      resultClass: entry.resultClass
    }, OWNERSHIP_TOP_REPO_LIMIT, (left, right) => (
      compareNullableDescending(left.severity, right.severity)
    ) || String(left.repo).localeCompare(String(right.repo)));
  }
  return {
    family,
    repoCount: rows.length,
    languages,
    methodologyMode: methodology?.mode || null,
    budgets: budget,
    reuse,
    rss: {
      sqliteAvgMb: roundValue(sqliteRssMb, 2),
      guardrail: guardrails[3]
    },
    throughput: {
      buildIndexMsAvg: roundValue(buildIndexMsAvg, 2),
      artifactTailStallPerRepo: roundValue(artifactTailStallPerRepo, 3),
      queueDelayHotspotPerRepo: roundValue(queueDelayHotspotPerRepo, 3),
      guardrails: {
        buildIndex: guardrails[4],
        artifactTailStallPerRepo: guardrails[5],
        queueDelayHotspotPerRepo: guardrails[6]
      }
    },
    phaseOwnership: {
      dominantPhase,
      dominantPhaseShare: roundValue(dominantPhaseShare, 4),
      guardrail: guardrails[7],
      repoCounts: phaseCounts
    },
    guardrails: {
      activeCount: activeGuardrails.length,
      breachedCount: breachedGuardrails.length,
      entries: guardrails
    },
    topOffenders
  };
};

export const buildBenchOwnershipSummary = ({
  tasks = [],
  methodology = null
} = {}) => {
  const taskRows = (Array.isArray(tasks) ? tasks : [])
    .map((entry) => ({
      family: resolveLanguageFamilyForTask(entry),
      row: buildTaskHotspotRow(entry, methodology, mergeBudget(resolveLanguageFamilyForTask(entry)))
    }));
  const families = new Map();
  for (const entry of taskRows) {
    if (!families.has(entry.family)) families.set(entry.family, []);
    families.get(entry.family).push(entry.row);
  }
  const familySummaries = Array.from(families.entries())
    .map(([family, rows]) => buildFamilySummary(family, rows, methodology))
    .sort((left, right) => (
      Number(right?.guardrails?.breachedCount || 0) - Number(left?.guardrails?.breachedCount || 0)
    ) || (
      compareNullableDescending(left?.throughput?.buildIndexMsAvg, right?.throughput?.buildIndexMsAvg)
    ) || left.family.localeCompare(right.family));
  const topHotspots = [];
  for (const family of familySummaries) {
    for (const offender of family.topOffenders) {
      pushOrderedLimited(topHotspots, {
        family: family.family,
        breachedGuardrails: family.guardrails.breachedCount,
        ...offender
      }, OWNERSHIP_TOP_REPO_LIMIT, (left, right) => (
        compareNullableDescending(left.severity, right.severity)
      ) || String(left.repo).localeCompare(String(right.repo)));
    }
  }
  return {
    schemaVersion: BENCH_OWNERSHIP_SCHEMA_VERSION,
    policyVersion: BENCH_OWNERSHIP_POLICY_VERSION,
    methodologyMode: methodology?.mode || null,
    familyCount: familySummaries.length,
    families: familySummaries,
    topHotspots
  };
};

const normalizeOwnershipSummary = (report) => {
  if (report?.ownership?.schemaVersion === BENCH_OWNERSHIP_SCHEMA_VERSION) return report.ownership;
  return buildBenchOwnershipSummary({
    tasks: report?.tasks || [],
    methodology: report?.methodology || null
  });
};

export const buildBenchOwnershipDiff = ({
  before = null,
  after = null
} = {}) => {
  const beforeSummary = normalizeOwnershipSummary(before);
  const afterSummary = normalizeOwnershipSummary(after);
  const beforeFamilies = new Map(
    (Array.isArray(beforeSummary?.families) ? beforeSummary.families : [])
      .map((entry) => [entry.family, entry])
  );
  const afterFamilies = new Map(
    (Array.isArray(afterSummary?.families) ? afterSummary.families : [])
      .map((entry) => [entry.family, entry])
  );
  const familyNames = Array.from(new Set([...beforeFamilies.keys(), ...afterFamilies.keys()])).sort();
  const byFamily = familyNames.map((family) => {
    const beforeFamily = beforeFamilies.get(family) || null;
    const afterFamily = afterFamilies.get(family) || null;
    return {
      family,
      repoCount: buildDelta(beforeFamily?.repoCount, afterFamily?.repoCount, 0),
      breachedGuardrails: buildDelta(beforeFamily?.guardrails?.breachedCount, afterFamily?.guardrails?.breachedCount, 0),
      buildIndexMsAvg: buildDelta(beforeFamily?.throughput?.buildIndexMsAvg, afterFamily?.throughput?.buildIndexMsAvg),
      artifactTailStallPerRepo: buildDelta(
        beforeFamily?.throughput?.artifactTailStallPerRepo,
        afterFamily?.throughput?.artifactTailStallPerRepo
      ),
      queueDelayHotspotPerRepo: buildDelta(
        beforeFamily?.throughput?.queueDelayHotspotPerRepo,
        afterFamily?.throughput?.queueDelayHotspotPerRepo
      ),
      sqliteAvgMb: buildDelta(beforeFamily?.rss?.sqliteAvgMb, afterFamily?.rss?.sqliteAvgMb),
      coldStartHitRate: buildDelta(
        beforeFamily?.reuse?.coldStart?.averageHitRate,
        afterFamily?.reuse?.coldStart?.averageHitRate
      ),
      intraRunHitRate: buildDelta(
        beforeFamily?.reuse?.intraRun?.averageHitRate,
        afterFamily?.reuse?.intraRun?.averageHitRate
      ),
      crossRunHitRate: buildDelta(
        beforeFamily?.reuse?.crossRun?.averageHitRate,
        afterFamily?.reuse?.crossRun?.averageHitRate
      ),
      dominantPhase: {
        before: beforeFamily?.phaseOwnership?.dominantPhase || null,
        after: afterFamily?.phaseOwnership?.dominantPhase || null
      },
      dominantPhaseShare: buildDelta(
        beforeFamily?.phaseOwnership?.dominantPhaseShare,
        afterFamily?.phaseOwnership?.dominantPhaseShare
      )
    };
  });
  const regressions = [];
  for (const entry of byFamily) {
    const severity = sumValues([
      entry.breachedGuardrails?.delta,
      entry.buildIndexMsAvg?.delta != null && entry.buildIndexMsAvg.delta > 0 ? entry.buildIndexMsAvg.delta / 1000 : 0,
      entry.sqliteAvgMb?.delta != null && entry.sqliteAvgMb.delta > 0 ? entry.sqliteAvgMb.delta / 256 : 0,
      entry.artifactTailStallPerRepo?.delta != null && entry.artifactTailStallPerRepo.delta > 0 ? entry.artifactTailStallPerRepo.delta * 5 : 0,
      entry.queueDelayHotspotPerRepo?.delta != null && entry.queueDelayHotspotPerRepo.delta > 0 ? entry.queueDelayHotspotPerRepo.delta * 5 : 0,
      entry.intraRunHitRate?.delta != null && entry.intraRunHitRate.delta < 0 ? Math.abs(entry.intraRunHitRate.delta) * 100 : 0,
      entry.crossRunHitRate?.delta != null && entry.crossRunHitRate.delta < 0 ? Math.abs(entry.crossRunHitRate.delta) * 100 : 0,
      entry.coldStartHitRate?.delta != null && entry.coldStartHitRate.delta < 0 ? Math.abs(entry.coldStartHitRate.delta) * 100 : 0
    ]);
    if (severity <= 0) continue;
    pushOrderedLimited(regressions, {
      family: entry.family,
      severity: roundValue(severity, 3),
      buildIndexMsAvg: entry.buildIndexMsAvg,
      sqliteAvgMb: entry.sqliteAvgMb,
      intraRunHitRate: entry.intraRunHitRate,
      crossRunHitRate: entry.crossRunHitRate,
      coldStartHitRate: entry.coldStartHitRate,
      breachedGuardrails: entry.breachedGuardrails,
      dominantPhase: entry.dominantPhase
    }, OWNERSHIP_TOP_REPO_LIMIT, (left, right) => (
      compareNullableDescending(left.severity, right.severity)
    ) || left.family.localeCompare(right.family));
  }
  return {
    schemaVersion: BENCH_OWNERSHIP_DIFF_SCHEMA_VERSION,
    policyVersion: BENCH_OWNERSHIP_POLICY_VERSION,
    byFamily,
    topRegressions: regressions
  };
};
