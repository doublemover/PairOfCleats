import { lineHasAnyInsensitive, shouldScanLine } from './utils.js';
import { parseDockerfileFromClause, parseDockerfileInstruction } from '../../../shared/dockerfile.js';

const normalizeImportToken = (value) => String(value || '')
  .trim()
  .replace(/^["']|["']$/g, '')
  .trim();

const extractCopyAddSource = (line) => {
  const fromFlag = line.match(/(?:^|\s)--from(?:=|\s+)([^\s,\\]+)/i);
  return fromFlag?.[1] ? normalizeImportToken(fromFlag[1]) : '';
};

const extractRunMountSources = (line) => {
  const out = [];
  const mountMatches = Array.from(line.matchAll(/(?:^|\s)--mount(?:=|\s+)([^\s\\]+)/gi));
  for (const match of mountMatches) {
    const spec = String(match[1] || '');
    const parts = spec.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (!/^from=/i.test(trimmed)) continue;
      const value = normalizeImportToken(trimmed.slice(trimmed.indexOf('=') + 1));
      if (value) out.push(value);
    }
  }
  return out;
};

export const collectDockerfileImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split(/\r?\n/);
  const precheck = (value) => lineHasAnyInsensitive(value, ['from', 'copy', 'add', '--mount']);

  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const from = parseDockerfileFromClause(line);
    if (from) {
      if (from.image) imports.add(from.image);
      if (from.stage) imports.add(from.stage);
    }
    const instruction = parseDockerfileInstruction(line);
    if (!instruction) continue;
    if (instruction.instruction === 'COPY' || instruction.instruction === 'ADD') {
      const source = extractCopyAddSource(line);
      if (source) imports.add(source);
      continue;
    }
    if (instruction.instruction === 'RUN') {
      for (const source of extractRunMountSources(line)) {
        imports.add(source);
      }
    }
  }

  return Array.from(imports);
};
