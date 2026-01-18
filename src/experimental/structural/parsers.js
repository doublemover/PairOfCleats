import fs from 'node:fs';
import path from 'node:path';

const parseJsonLines = (text) => text
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

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
    parsed = parseJsonLines(output);
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const results = [];
  for (const entry of entries) {
    if (!entry) continue;
    const matches = Array.isArray(entry.matches) ? entry.matches : [];
    const ruleId = entry.ruleId || entry.rule?.id || null;
    for (const match of matches) {
      const range = match.range || {};
      const start = range.start || {};
      const end = range.end || {};
      results.push(normalizeResult({
        engine: 'ast-grep',
        pack,
        ruleId,
        message: match.message || entry.message || null,
        severity: entry.severity || null,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        path: entry.file || entry.path || null,
        startLine: start.line ?? null,
        startCol: start.column ?? null,
        endLine: end.line ?? null,
        endCol: end.column ?? null,
        snippet: match.text || match.matched || null,
        metadata: entry.metadata || null
      }));
    }
  }
  return results;
};

export const parseComby = (output, pack, ruleId, message) => {
  const entries = parseJsonLines(output);
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
  return {
    id: payload.id || path.basename(rulePath),
    message: payload.message || null,
    language: payload.language || '.',
    pattern: payload.pattern || '',
    rewrite: payload.rewrite || ''
  };
};
