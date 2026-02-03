import fs from 'node:fs';
import path from 'node:path';

const parseJsonLines = (text) => {
  const items = [];
  const errors = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const [idx, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    try {
      items.push(JSON.parse(line));
    } catch (err) {
      errors.push({ line: idx + 1, error: err?.message || String(err) });
    }
  }
  return { items, errors };
};

const mergeTags = (tags = [], packTags = []) => {
  const combined = [...tags, ...packTags].map((entry) => String(entry)).filter(Boolean);
  return Array.from(new Set(combined));
};

const normalizeResult = (input) => ({
  engine: input.engine,
  pack: input.pack?.id || null,
  ruleId: input.ruleId || null,
  message: input.message || null,
  severity: input.severity || input.pack?.severity || null,
  tags: mergeTags(input.tags || [], input.pack?.tags || []),
  path: input.path || null,
  startLine: input.startLine ?? null,
  startCol: input.startCol ?? null,
  endLine: input.endLine ?? null,
  endCol: input.endCol ?? null,
  snippet: input.snippet || null,
  metadata: input.metadata || null
});

export const parseSemgrep = (output, pack) => {
  if (!output.trim()) return [];
  const payload = JSON.parse(output);
  const results = Array.isArray(payload.results) ? payload.results : [];
  return results.map((entry) => normalizeResult({
    engine: 'semgrep',
    pack,
    ruleId: entry.check_id || null,
    message: entry.extra?.message || null,
    severity: entry.extra?.severity || null,
    tags: Array.isArray(entry.extra?.metadata?.category)
      ? entry.extra.metadata.category
      : (Array.isArray(entry.extra?.metadata?.tags) ? entry.extra.metadata.tags : []),
    path: entry.path || null,
    startLine: entry.start?.line ?? null,
    startCol: entry.start?.col ?? null,
    endLine: entry.end?.line ?? null,
    endCol: entry.end?.col ?? null,
    snippet: entry.extra?.lines || null,
    metadata: entry.extra?.metadata || null
  }));
};

export const parseAstGrep = (output, pack) => {
  if (!output.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    const { items, errors } = parseJsonLines(output);
    if (errors.length && !items.length) {
      const err = new Error(`ast-grep output parse failed (${errors.length} error(s)).`);
      err.parseErrors = errors;
      throw err;
    }
    parsed = items;
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const results = [];
  for (const entry of entries) {
    if (!entry) continue;
    const ruleId = entry.ruleId || entry.rule?.id || entry.rule || null;
    const matches = Array.isArray(entry.matches)
      ? entry.matches
      : (entry.range && (entry.file || entry.path) ? [entry] : []);
    const entryPath = entry.file || entry.path || null;
    for (const match of matches) {
      const range = match.range || entry.range || {};
      const start = range.start || match.start || {};
      const end = range.end || match.end || {};
      results.push(normalizeResult({
        engine: 'ast-grep',
        pack,
        ruleId: match.ruleId || ruleId,
        message: match.message || entry.message || null,
        severity: entry.severity || match.severity || null,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        path: match.file || match.path || entryPath,
        startLine: start.line ?? null,
        startCol: start.column ?? start.col ?? null,
        endLine: end.line ?? null,
        endCol: end.column ?? end.col ?? null,
        snippet: match.text || match.matched || entry.text || null,
        metadata: entry.metadata || null
      }));
    }
  }
  return results;
};

export const parseComby = (output, pack, ruleId, message) => {
  const { items: entries, errors } = parseJsonLines(output);
  if (errors.length && !entries.length) {
    const err = new Error(`comby output parse failed (${errors.length} error(s)).`);
    err.parseErrors = errors;
    throw err;
  }
  const results = [];
  for (const entry of entries) {
    if (!entry) continue;
    const matches = Array.isArray(entry.matches) ? entry.matches : [];
    for (const match of matches) {
      const range = match.range || {};
      const start = range.start || {};
      const end = range.end || {};
      results.push(normalizeResult({
        engine: 'comby',
        pack,
        ruleId,
        message: message || null,
        severity: entry.severity || null,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        path: entry.uri || entry.path || null,
        startLine: start.line ?? null,
        startCol: start.col ?? null,
        endLine: end.line ?? null,
        endCol: end.col ?? null,
        snippet: match.matched || null,
        metadata: entry.metadata || null
      }));
    }
  }
  return results;
};

export const readCombyRule = (rulePath) => {
  const payload = JSON.parse(fs.readFileSync(rulePath, 'utf8'));
  if (!payload || typeof payload !== 'object') {
    throw new Error(`Invalid comby rule payload: ${rulePath}`);
  }
  const language = payload.language || '.';
  const pattern = typeof payload.pattern === 'string' ? payload.pattern : '';
  if (!pattern.trim()) {
    throw new Error(`Comby rule is missing a pattern: ${rulePath}`);
  }
  if (!language || typeof language !== 'string') {
    throw new Error(`Comby rule is missing a language: ${rulePath}`);
  }
  return {
    id: payload.id || path.basename(rulePath),
    message: payload.message || null,
    language,
    pattern: pattern.trim(),
    rewrite: payload.rewrite || ''
  };
};
