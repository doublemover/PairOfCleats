import { sha1 } from '../../shared/hash.js';
import { toPosix } from '../../shared/files.js';
import { toArray } from '../../shared/iterables.js';

const ROW_SCHEMA_VERSION = 1;
const MAX_ROW_BYTES = 32 * 1024;
const CAPS = {
  maxSignalsPerKind: 50,
  maxEvidencePerSignal: 5,
  maxTagsPerSignal: 10,
  maxLocalFlows: 50,
  maxTaintIdentifiers: 50
};
const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 };

const toPosixPath = (value) => (value ? toPosix(String(value)) : null);

const normalizeSnippetHash = (raw) => {
  const normalized = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return `sha1:${sha1(normalized)}`;
};

const normalizeEvidenceEntry = (entry, chunk) => {
  if (!entry || typeof entry !== 'object') return null;
  const line = Number(entry.line);
  const column = Number(entry.column);
  if (!Number.isFinite(line) || !Number.isFinite(column)) return null;
  const offset = Number.isFinite(chunk?.startLine) ? chunk.startLine - 1 : 0;
  const startLine = line + offset;
  const startCol = column;
  return {
    file: toPosixPath(chunk?.file) || null,
    startLine,
    startCol,
    endLine: startLine,
    endCol: startCol,
    snippetHash: normalizeSnippetHash(entry.excerpt)
  };
};

const evidenceSortKey = (entry) => {
  if (!entry) return 'zzzz';
  const file = entry.file || '';
  const startLine = Number.isFinite(entry.startLine) ? String(entry.startLine).padStart(8, '0') : 'zzzzzzzz';
  const startCol = Number.isFinite(entry.startCol) ? String(entry.startCol).padStart(8, '0') : 'zzzzzzzz';
  const endLine = Number.isFinite(entry.endLine) ? String(entry.endLine).padStart(8, '0') : 'zzzzzzzz';
  const endCol = Number.isFinite(entry.endCol) ? String(entry.endCol).padStart(8, '0') : 'zzzzzzzz';
  const hash = entry.snippetHash || '';
  return `${file}|${startLine}|${startCol}|${endLine}|${endCol}|${hash}`;
};

const sortEvidence = (list) => {
  if (!Array.isArray(list)) return [];
  return list.slice().sort((a, b) => {
    const keyA = evidenceSortKey(a);
    const keyB = evidenceSortKey(b);
    if (keyA < keyB) return -1;
    if (keyA > keyB) return 1;
    return 0;
  });
};

const normalizeEvidenceList = (raw, chunk) => {
  if (!raw) return [];
  const entries = Array.isArray(raw) ? raw : [raw];
  const normalized = entries.map((entry) => normalizeEvidenceEntry(entry, chunk)).filter(Boolean);
  return sortEvidence(normalized);
};

const minEvidenceKey = (evidence) => {
  if (!Array.isArray(evidence) || !evidence.length) return 'zzzz';
  return evidenceSortKey(evidence[0]);
};

const normalizeTags = (tags) => {
  if (!Array.isArray(tags)) return [];
  const normalized = tags.map((entry) => (entry == null ? null : String(entry).trim())).filter(Boolean);
  normalized.sort();
  return normalized.slice(0, CAPS.maxTagsPerSignal);
};

const normalizeSignal = (entry, type, chunk) => {
  if (!entry || typeof entry !== 'object') return null;
  const evidence = normalizeEvidenceList(entry.evidence, chunk);
  const signal = {
    ruleId: entry.ruleId || entry.id || null,
    ruleName: entry.name || null,
    ruleType: entry.ruleType || type,
    category: entry.category || null,
    severity: entry.severity || null,
    confidence: Number.isFinite(entry.confidence) ? entry.confidence : null,
    tags: normalizeTags(entry.tags),
    evidence
  };
  if (!signal.ruleId || !signal.ruleName) return null;
  return signal;
};

const signalSortKey = (signal) => {
  if (!signal) return { severityRank: -1, id: '', evidence: 'zzzz' };
  const severityRank = SEVERITY_RANK[signal.severity] || 0;
  return {
    severityRank,
    id: signal.ruleId || '',
    evidence: minEvidenceKey(signal.evidence)
  };
};

const normalizeSignals = (entries, type, chunk) => {
  if (!Array.isArray(entries)) return [];
  const normalized = entries
    .map((entry) => normalizeSignal(entry, type, chunk))
    .filter(Boolean);
  normalized.sort((a, b) => {
    const keyA = signalSortKey(a);
    const keyB = signalSortKey(b);
    if (keyA.severityRank !== keyB.severityRank) return keyB.severityRank - keyA.severityRank;
    if (keyA.id < keyB.id) return -1;
    if (keyA.id > keyB.id) return 1;
    if (keyA.evidence < keyB.evidence) return -1;
    if (keyA.evidence > keyB.evidence) return 1;
    return 0;
  });
  return normalized;
};

const normalizeLocalFlows = (flows, chunk) => {
  if (!Array.isArray(flows)) return [];
  const normalized = flows.map((flow) => {
    if (!flow || typeof flow !== 'object') return null;
    const evidence = normalizeEvidenceList(flow.evidence, chunk);
    const ruleIds = Array.isArray(flow.ruleIds) ? flow.ruleIds : [];
    const sourceRuleId = ruleIds[0] || flow.source || null;
    const sinkRuleId = ruleIds[1] || flow.sink || null;
    return {
      sourceRuleId,
      sinkRuleId,
      category: flow.category || null,
      severity: flow.severity || null,
      confidence: Number.isFinite(flow.confidence) ? flow.confidence : null,
      evidence
    };
  }).filter((entry) => entry && entry.sourceRuleId && entry.sinkRuleId);
  normalized.sort((a, b) => {
    const keyA = `${a.sourceRuleId}|${a.sinkRuleId}|${minEvidenceKey(a.evidence)}`;
    const keyB = `${b.sourceRuleId}|${b.sinkRuleId}|${minEvidenceKey(b.evidence)}`;
    if (keyA < keyB) return -1;
    if (keyA > keyB) return 1;
    return 0;
  });
  return normalized;
};

const buildSummaryTotals = (risk) => ({
  sources: Array.isArray(risk?.sources) ? risk.sources.length : 0,
  sinks: Array.isArray(risk?.sinks) ? risk.sinks.length : 0,
  sanitizers: Array.isArray(risk?.sanitizers) ? risk.sanitizers.length : 0,
  localFlows: Array.isArray(risk?.flows) ? risk.flows.length : 0
});

const maxSeverity = (entries) => {
  let best = null;
  let bestRank = 0;
  for (const entry of toArray(entries)) {
    const rank = SEVERITY_RANK[entry?.severity] || 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = entry.severity;
    }
  }
  return best || null;
};

const pickTopEntries = (counts, limit) => {
  const entries = Array.from(counts.entries());
  entries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    return 0;
  });
  return entries.slice(0, limit).map(([key]) => key);
};

const updateSummaryCounts = (counts, values) => {
  for (const value of toArray(values)) {
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
};

const buildCompactSummary = ({ risk, interprocedural }) => {
  if (!risk || typeof risk !== 'object') return null;
  const totalSources = Array.isArray(risk.sources) ? risk.sources.length : 0;
  const totalSinks = Array.isArray(risk.sinks) ? risk.sinks.length : 0;
  const totalSanitizers = Array.isArray(risk.sanitizers) ? risk.sanitizers.length : 0;
  const totalFlows = Array.isArray(risk.flows) ? risk.flows.length : 0;
  if (!totalSources && !totalSinks && !totalSanitizers && !totalFlows) return null;

  const categoryCounts = new Map();
  const tagCounts = new Map();
  const collectFrom = (entries) => {
    for (const entry of toArray(entries)) {
      if (entry?.category) updateSummaryCounts(categoryCounts, [entry.category]);
      if (Array.isArray(entry?.tags)) updateSummaryCounts(tagCounts, entry.tags);
    }
  };
  collectFrom(risk.sources);
  collectFrom(risk.sinks);
  collectFrom(risk.sanitizers);

  return {
    sources: { count: totalSources },
    sinks: { count: totalSinks, maxSeverity: maxSeverity(risk.sinks) },
    sanitizers: { count: totalSanitizers },
    localFlows: { count: totalFlows },
    topCategories: pickTopEntries(categoryCounts, 5),
    topTags: pickTopEntries(tagCounts, 8),
    interprocedural: {
      enabled: !!interprocedural?.enabled,
      summaryOnly: !!interprocedural?.summaryOnly
    }
  };
};

const buildTaintHints = (risk) => {
  const tainted = Array.isArray(risk?.taintHints?.taintedIdentifiers)
    ? risk.taintHints.taintedIdentifiers
    : [];
  if (!tainted.length) return null;
  const normalized = Array.from(new Set(tainted.map((entry) => String(entry).trim()).filter(Boolean)));
  normalized.sort();
  return {
    taintedIdentifiers: normalized.slice(0, CAPS.maxTaintIdentifiers)
  };
};

const clampSignals = (list, max) => {
  if (!Array.isArray(list)) return { list: [], truncated: false };
  if (list.length <= max) return { list, truncated: false };
  return { list: list.slice(0, max), truncated: true };
};

const clampEvidence = (signals) => {
  let truncatedEvidence = false;
  for (const signal of toArray(signals)) {
    if (!signal?.evidence) continue;
    if (signal.evidence.length > CAPS.maxEvidencePerSignal) {
      signal.evidence = signal.evidence.slice(0, CAPS.maxEvidencePerSignal);
      truncatedEvidence = true;
    }
  }
  return truncatedEvidence;
};

const buildRiskSummaryRow = ({ chunk, interprocedural }) => {
  const risk = chunk?.docmeta?.risk || null;
  if (!risk) return null;
  const chunkUid = chunk?.chunkUid || chunk?.metaV2?.chunkUid || null;
  const file = toPosixPath(chunk?.file);
  if (!chunkUid || !file) return null;

  const sources = normalizeSignals(risk.sources, 'source', chunk);
  const sinks = normalizeSignals(risk.sinks, 'sink', chunk);
  const sanitizers = normalizeSignals(risk.sanitizers, 'sanitizer', chunk);
  const localFlows = normalizeLocalFlows(risk.flows, chunk);

  const totals = buildSummaryTotals(risk);
  const truncated = {
    sources: false,
    sinks: false,
    sanitizers: false,
    localFlows: false,
    evidence: false
  };

  const sourcesClamp = clampSignals(sources, CAPS.maxSignalsPerKind);
  const sinksClamp = clampSignals(sinks, CAPS.maxSignalsPerKind);
  const sanitizersClamp = clampSignals(sanitizers, CAPS.maxSignalsPerKind);
  const flowsClamp = clampSignals(localFlows, CAPS.maxLocalFlows);
  truncated.sources = sourcesClamp.truncated;
  truncated.sinks = sinksClamp.truncated;
  truncated.sanitizers = sanitizersClamp.truncated;
  truncated.localFlows = flowsClamp.truncated;

  const signals = {
    sources: sourcesClamp.list,
    sinks: sinksClamp.list,
    sanitizers: sanitizersClamp.list,
    localFlows: flowsClamp.list
  };

  if (clampEvidence(signals.sources)) truncated.evidence = true;
  if (clampEvidence(signals.sinks)) truncated.evidence = true;
  if (clampEvidence(signals.sanitizers)) truncated.evidence = true;
  if (clampEvidence(signals.localFlows)) truncated.evidence = true;

  const taintHints = buildTaintHints(risk);
  const row = {
    schemaVersion: ROW_SCHEMA_VERSION,
    chunkUid,
    file,
    languageId: chunk?.lang || chunk?.segment?.languageId || chunk?.containerLanguageId || null,
    symbol: {
      name: chunk?.name || null,
      kind: chunk?.kind || null,
      signature: chunk?.docmeta?.signature || null
    },
    signals,
    ...(taintHints ? { taintHints } : {}),
    totals,
    truncated
  };

  return { row, risk };
};

const measureRowBytes = (row) => Buffer.byteLength(JSON.stringify(row), 'utf8');

const stripTags = (signals) => {
  for (const list of Object.values(signals || {})) {
    for (const entry of toArray(list)) {
      if (entry && Array.isArray(entry.tags)) entry.tags = [];
    }
  }
};

const shrinkEvidence = (signals, maxPerSignal) => {
  let truncatedEvidence = false;
  for (const list of Object.values(signals || {})) {
    for (const entry of toArray(list)) {
      if (!entry?.evidence) continue;
      if (maxPerSignal === 0 && entry.evidence.length) {
        entry.evidence = [];
        truncatedEvidence = true;
        continue;
      }
      if (entry.evidence.length > maxPerSignal) {
        entry.evidence = entry.evidence.slice(0, maxPerSignal);
        truncatedEvidence = true;
      }
    }
  }
  return truncatedEvidence;
};

const enforceRowSize = (row, truncated) => {
  if (measureRowBytes(row) <= MAX_ROW_BYTES) return row;
  stripTags(row.signals);
  if (measureRowBytes(row) <= MAX_ROW_BYTES) return row;
  if (shrinkEvidence(row.signals, 1)) truncated.evidence = true;
  if (measureRowBytes(row) <= MAX_ROW_BYTES) return row;
  if (shrinkEvidence(row.signals, 0)) truncated.evidence = true;
  if (measureRowBytes(row) <= MAX_ROW_BYTES) return row;
  return null;
};

const resolveInterproceduralSummaryState = ({ runtime, mode }) => {
  const policy = runtime?.analysisPolicy || {};
  const enabled = typeof policy?.risk?.interprocedural === 'boolean'
    ? policy.risk.interprocedural
    : runtime?.riskInterproceduralEnabled;
  const summaryOnly = typeof policy?.risk?.interproceduralSummaryOnly === 'boolean'
    ? policy.risk.interproceduralSummaryOnly
    : runtime?.riskInterproceduralConfig?.summaryOnly === true;
  const modeEnabled = mode === 'code' && enabled === true;
  return {
    enabled: modeEnabled,
    summaryOnly: modeEnabled && summaryOnly === true
  };
};

export const buildRiskSummaries = ({ chunks, runtime = null, mode = null, log = null } = {}) => {
  const rows = [];
  const stats = {
    candidates: 0,
    emitted: 0,
    summariesDroppedBySize: 0
  };
  const interprocedural = resolveInterproceduralSummaryState({ runtime, mode });
  for (const chunk of toArray(chunks)) {
    const built = buildRiskSummaryRow({ chunk, interprocedural });
    if (!built) continue;
    stats.candidates += 1;
    const { row, risk } = built;
    const trimmed = enforceRowSize(row, row.truncated);
    if (!trimmed) {
      stats.summariesDroppedBySize += 1;
      if (log) log(`[risk] summary dropped due to size: ${row.file}`);
      continue;
    }
    rows.push(trimmed);
    stats.emitted += 1;
    const compact = buildCompactSummary({ risk, interprocedural });
    if (compact) {
      if (!chunk.docmeta || typeof chunk.docmeta !== 'object') chunk.docmeta = {};
      if (!chunk.docmeta.risk || typeof chunk.docmeta.risk !== 'object') chunk.docmeta.risk = risk;
      chunk.docmeta.risk.summary = compact;
    }
  }
  return { rows, stats };
};
