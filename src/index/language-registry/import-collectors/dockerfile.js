import { lineHasAnyInsensitive, shouldScanLine } from './utils.js';
import { parseDockerfileFromClause, parseDockerfileInstruction } from '../../../shared/dockerfile.js';

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
    if (instruction.instruction === 'COPY' || instruction.instruction === 'ADD' || instruction.instruction === 'RUN') {
      const fromFlag = line.match(/\bfrom(?:=|\s+)([^\s,]+)/i);
      if (fromFlag?.[1]) imports.add(fromFlag[1]);
    }
  }

  return Array.from(imports);
};
