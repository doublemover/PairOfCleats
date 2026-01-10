import { normalizeRiskRules } from './risk-rules.js';

const DEFAULT_CAPS = {
  maxBytes: 200 * 1024,
  maxLines: 3000,
  maxNodes: 15000,
  maxEdges: 45000,
  maxMs: 75,
  maxFlows: 150
};

const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 };

const normalizeCap = (value, fallback) => {
  if (value === 0 || value === false) return null;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return fallback;
};

export function normalizeRiskConfig(raw = {}, { rootDir } = {}) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const rulesInput = input.rules !== undefined ? input.rules : input;
  const caps = input.caps && typeof input.caps === 'object' ? input.caps : {};
  return {
    enabled: input.enabled !== false,
    rules: normalizeRiskRules(rulesInput, { rootDir }),
    caps: {
      maxBytes: normalizeCap(caps.maxBytes, DEFAULT_CAPS.maxBytes),
      maxLines: normalizeCap(caps.maxLines, DEFAULT_CAPS.maxLines),
      maxNodes: normalizeCap(caps.maxNodes, DEFAULT_CAPS.maxNodes),
      maxEdges: normalizeCap(caps.maxEdges, DEFAULT_CAPS.maxEdges),
      maxMs: normalizeCap(caps.maxMs, DEFAULT_CAPS.maxMs),
      maxFlows: normalizeCap(caps.maxFlows, DEFAULT_CAPS.maxFlows)
    }
  };
}

const buildEvidence = (line, lineNo, column) => {
  const trimmed = String(line || '').trim();
  const excerpt = trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
  return {
    line: lineNo,
    column,
    excerpt: excerpt || null
  };
};

const lineContainsVar = (line, name) => {
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`\\b${escaped}\\b`);
  return rx.test(line);
};

const matchRuleOnLine = (rule, line, languageId) => {
  if (!rule || !Array.isArray(rule.patterns)) return null;
  if (rule.languages && languageId) {
    const allowed = rule.languages.map((entry) => String(entry).toLowerCase());
    if (!allowed.includes(String(languageId).toLowerCase())) return null;
  }
  if (rule.requires) {
    rule.requires.lastIndex = 0;
    if (!rule.requires.test(line)) return null;
  }
  for (const pattern of rule.patterns) {
    if (!pattern) continue;
    pattern.lastIndex = 0;
    const match = pattern.exec(line);
    if (match) return { index: match.index, match: match[0] };
  }
  return null;
};

const collectLineMatches = (rules, line, lineNo, languageId) => {
  const matches = [];
  for (const rule of rules || []) {
    const hit = matchRuleOnLine(rule, line, languageId);
    if (!hit) continue;
    matches.push({
      rule,
      evidence: buildEvidence(line, lineNo, hit.index + 1)
    });
  }
  return matches;
};

const dedupeMatches = (entries) => {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const key = entry?.rule?.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
};

const buildRiskEntries = (matches, type) => matches.map(({ rule, evidence }) => ({
  id: rule.id,
  name: rule.name,
  category: rule.category || null,
  severity: rule.severity || null,
  tags: Array.isArray(rule.tags) ? rule.tags.slice() : [],
  confidence: Number.isFinite(rule.confidence) ? rule.confidence : null,
  ruleId: rule.id,
  ruleType: type,
  evidence
}));

const maxSeverity = (entries) => {
  let best = null;
  let bestRank = 0;
  for (const entry of entries || []) {
    const rank = SEVERITY_RANK[entry.severity] || 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = entry.severity;
    }
  }
  return best || null;
};

const isAssignment = (line) => {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) return null;
  if (trimmed.includes('==') || trimmed.includes('!=') || trimmed.includes('=>')) return null;
  if (trimmed.includes('>=') || trimmed.includes('<=')) return null;
  let match = trimmed.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/);
  if (!match) {
    match = trimmed.match(/^([A-Za-z_$][\w$]*)\s*=\s*(.+)$/);
  }
  if (!match) return null;
  return { name: match[1], rhs: match[2] };
};

const combineSourceEvidence = (sourceMatches, taintedSources) => {
  const sources = [];
  const ruleIds = new Set();
  for (const match of sourceMatches || []) {
    sources.push(match);
    ruleIds.add(match.rule.id);
  }
  for (const entry of taintedSources || []) {
    if (!entry) continue;
    sources.push(entry);
    if (entry.ruleId) ruleIds.add(entry.ruleId);
  }
  return { sources, ruleIds: Array.from(ruleIds) };
};

/**
 * Detect taint-like risk signals in a chunk.
 * @param {{text:string,chunk?:object,config?:object,languageId?:string}} input
 * @returns {object|null}
 */
export function detectRiskSignals({ text, chunk, config, languageId } = {}) {
  if (!text) return null;
  const riskConfig = config && typeof config === 'object'
    ? config
    : normalizeRiskConfig({});
  if (!riskConfig.enabled) return null;

  const rules = riskConfig.rules || { sources: [], sinks: [], sanitizers: [], provenance: {} };
  const caps = riskConfig.caps || DEFAULT_CAPS;
  const bytes = Buffer.byteLength(text, 'utf8');
  const lines = text.split(/\r?\n/);
  const analysisStart = Date.now();
  const analysisStatus = {
    status: 'ok',
    reason: null,
    caps: {
      maxBytes: caps.maxBytes,
      maxLines: caps.maxLines,
      maxNodes: caps.maxNodes,
      maxEdges: caps.maxEdges,
      maxMs: caps.maxMs
    },
    bytes,
    lines: lines.length
  };

  const exceeded = [];
  if (caps.maxBytes && bytes > caps.maxBytes) exceeded.push('maxBytes');
  if (caps.maxLines && lines.length > caps.maxLines) exceeded.push('maxLines');
  if (exceeded.length) {
    analysisStatus.status = 'capped';
    analysisStatus.reason = exceeded.join('|');
  }

  const matchesByLine = [];
  for (let i = 0; i < lines.length; i += 1) {
    matchesByLine.push({
      line: lines[i],
      lineNo: i + 1,
      sources: collectLineMatches(rules.sources, lines[i], i + 1, languageId),
      sinks: collectLineMatches(rules.sinks, lines[i], i + 1, languageId),
      sanitizers: collectLineMatches(rules.sanitizers, lines[i], i + 1, languageId)
    });
  }

  const sourcesRaw = dedupeMatches(matchesByLine.flatMap((entry) => entry.sources));
  const sinksRaw = dedupeMatches(matchesByLine.flatMap((entry) => entry.sinks));
  const sanitizersRaw = dedupeMatches(matchesByLine.flatMap((entry) => entry.sanitizers));

  const sources = buildRiskEntries(sourcesRaw, 'source');
  const sinks = buildRiskEntries(sinksRaw, 'sink');
  const sanitizers = buildRiskEntries(sanitizersRaw, 'sanitizer');

  const flows = [];
  const flowKeys = new Set();
  const addFlow = (flow) => {
    if (!flow) return;
    const key = `${flow.source}:${flow.sink}:${flow.scope || 'local'}:${flow.via || ''}`;
    if (flowKeys.has(key)) return;
    if (caps.maxFlows && flows.length >= caps.maxFlows) return;
    flowKeys.add(key);
    flows.push(flow);
  };

  if (analysisStatus.status === 'ok') {
    const taint = new Map();
    let nodes = 0;
    let edges = 0;
    for (const entry of matchesByLine) {
      if (caps.maxMs && Date.now() - analysisStart > caps.maxMs) {
        analysisStatus.status = 'capped';
        analysisStatus.reason = 'maxMs';
        break;
      }
      const { line, sources: sourceMatches, sinks: sinkMatches, sanitizers: sanitizerMatches } = entry;
      const sanitizedVars = [];
      if (sanitizerMatches.length && taint.size) {
        for (const name of taint.keys()) {
          if (lineContainsVar(line, name)) sanitizedVars.push(name);
        }
        for (const name of sanitizedVars) taint.delete(name);
      }

      const assignment = isAssignment(line);
      if (assignment) {
        nodes += 1;
        const rhsTainted = [];
        for (const [name, info] of taint.entries()) {
          if (lineContainsVar(assignment.rhs, name)) {
            rhsTainted.push(...(info.sources || []));
          }
        }
        const { sources: newSources, ruleIds } = combineSourceEvidence(sourceMatches, rhsTainted);
        if (newSources.length) {
          const confidence = Math.max(...newSources.map((entry) => entry.confidence || 0));
          taint.set(assignment.name, { sources: newSources, ruleIds, confidence });
          edges += newSources.length;
        }
      }

      if (sinkMatches.length) {
        nodes += 1;
        const taintedSources = [];
        for (const [name, info] of taint.entries()) {
          if (lineContainsVar(line, name)) {
            taintedSources.push(...(info.sources || []));
          }
        }
        const { sources: lineSources } = combineSourceEvidence(sourceMatches, taintedSources);
        if (lineSources.length) {
          for (const source of lineSources) {
            for (const sink of sinkMatches) {
              addFlow({
                source: source.rule.name,
                sink: sink.rule.name,
                category: sink.rule.category || null,
                severity: sink.rule.severity || null,
                scope: 'local',
                confidence: Math.min(1, (source.rule.confidence || 0.5) * (sink.rule.confidence || 0.5) + 0.1),
                ruleIds: [source.rule.id, sink.rule.id],
                evidence: buildEvidence(line, entry.lineNo, 1)
              });
            }
          }
        }
        edges += sinkMatches.length;
      }

      if (caps.maxNodes && nodes > caps.maxNodes) {
        analysisStatus.status = 'capped';
        analysisStatus.reason = 'maxNodes';
        break;
      }
      if (caps.maxEdges && edges > caps.maxEdges) {
        analysisStatus.status = 'capped';
        analysisStatus.reason = 'maxEdges';
        break;
      }
    }
  }

  if (!sources.length && !sinks.length && !sanitizers.length && !flows.length) {
    return null;
  }

  const tags = new Set();
  const categories = new Set();
  const confidences = [];
  sources.forEach((entry) => {
    (entry.tags || []).forEach((tag) => tags.add(tag));
    if (entry.category) categories.add(entry.category);
    if (Number.isFinite(entry.confidence)) confidences.push(entry.confidence);
  });
  sinks.forEach((entry) => {
    (entry.tags || []).forEach((tag) => tags.add(tag));
    if (entry.category) categories.add(entry.category);
    if (Number.isFinite(entry.confidence)) confidences.push(entry.confidence);
  });
  sanitizers.forEach((entry) => {
    (entry.tags || []).forEach((tag) => tags.add(tag));
    if (entry.category) categories.add(entry.category);
    if (Number.isFinite(entry.confidence)) confidences.push(entry.confidence);
  });
  flows.forEach((entry) => {
    if (Number.isFinite(entry.confidence)) confidences.push(entry.confidence);
  });

  const risk = {
    tags: Array.from(tags),
    categories: Array.from(categories),
    severity: maxSeverity(sinks) || (sources.length ? 'low' : null),
    confidence: confidences.length ? Math.max(...confidences) : null,
    sources,
    sinks,
    sanitizers,
    flows,
    analysisStatus,
    ruleProvenance: rules.provenance || null
  };

  if (!risk.tags.length) risk.tags = [];
  if (!risk.categories.length) risk.categories = [];
  return risk;
}
