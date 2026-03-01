import { createCollectorBudgetContext, lineHasAnyInsensitive, shouldScanLine } from './utils.js';
import { parseDockerfileFromClause, parseDockerfileInstruction } from '../../../shared/dockerfile.js';

const DOCKERFILE_SCAN_BUDGET = Object.freeze({
  maxChars: 786432,
  maxMatches: 4096,
  maxTokens: 2048,
  maxMs: 30
});

const normalizeImportToken = (value) => String(value || '')
  .trim()
  .replace(/^["']|["']$/g, '')
  .trim();

const extractCopyAddSource = (line) => {
  const fromFlag = line.match(/(?:^|\s)--from(?:=|\s+)([^\s,\\]+)/i);
  return fromFlag?.[1] ? normalizeImportToken(fromFlag[1]) : '';
};

const extractRunMountSources = (line, scanBudget = null) => {
  const out = [];
  const mountMatcher = /(?:^|\s)--mount(?:=|\s+)([^\s\\]+)/gi;
  let match;
  while (!scanBudget?.exhausted && (match = mountMatcher.exec(line)) !== null) {
    if (scanBudget && !scanBudget.consumeMatch()) break;
    const spec = String(match[1] || '');
    const parts = spec.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (!/^from=/i.test(trimmed)) continue;
      const value = normalizeImportToken(trimmed.slice(trimmed.indexOf('=') + 1));
      if (value) out.push(value);
    }
    if (!match[0]) mountMatcher.lastIndex += 1;
  }
  return out;
};

const toLogicalDockerfileLines = (text) => {
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  let current = '';
  for (const rawLine of lines) {
    const line = String(rawLine || '');
    const trimmed = line.trim();
    if (!trimmed) {
      if (current) {
        out.push(current.trim());
        current = '';
      }
      continue;
    }
    const withoutContinuation = line.replace(/\\\s*$/, '').trim();
    current = current ? `${current} ${withoutContinuation}`.trim() : withoutContinuation;
    const hasContinuation = /\\\s*$/.test(line);
    if (hasContinuation) continue;
    out.push(current.trim());
    current = '';
  }
  if (current) out.push(current.trim());
  return out;
};

export const collectDockerfileImports = (text, options = {}) => {
  const imports = new Set();
  const budgetContext = createCollectorBudgetContext({
    text,
    options,
    collectorId: 'dockerfile',
    defaults: DOCKERFILE_SCAN_BUDGET
  });
  const { scanBudget } = budgetContext;
  try {
    const lines = toLogicalDockerfileLines(budgetContext.source);
    const precheck = (value) => lineHasAnyInsensitive(value, ['from', 'copy', 'add', '--mount']);
    for (const line of lines) {
      if (scanBudget.exhausted || !scanBudget.consumeTime()) break;
      if (!shouldScanLine(line, precheck)) continue;
      const from = parseDockerfileFromClause(line);
      if (from) {
        if (from.image && scanBudget.consumeToken()) imports.add(from.image);
        if (from.stage && scanBudget.consumeToken()) imports.add(from.stage);
      }
      const instruction = parseDockerfileInstruction(line);
      if (!instruction) continue;
      if (instruction.instruction === 'COPY' || instruction.instruction === 'ADD') {
        const source = extractCopyAddSource(line);
        if (source && scanBudget.consumeToken()) imports.add(source);
        continue;
      }
      if (instruction.instruction === 'RUN') {
        for (const source of extractRunMountSources(line, scanBudget)) {
          if (!scanBudget.consumeToken()) break;
          imports.add(source);
        }
      }
    }
    return Array.from(imports);
  } finally {
    budgetContext.finalize();
  }
};
