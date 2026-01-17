import { lineHasAnyInsensitive, shouldScanLine } from './utils.js';

export const collectDockerfileImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split(/\r?\n/);
  const precheck = (value) => lineHasAnyInsensitive(value, ['from', 'copy', 'add']);

  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    // FROM <image> [AS <stage>]
    const fromMatch = line.match(/^\s*FROM\s+([^\s]+)(?:\s+AS\s+([^\s]+))?/i);
    if (fromMatch) {
      if (fromMatch[1]) imports.add(fromMatch[1]);
      if (fromMatch[2]) imports.add(fromMatch[2]);
    }

    // COPY/ADD --from=<stage-or-image>
    if (/^\s*(COPY|ADD)\b/i.test(line)) {
      const fromFlag = line.match(/--from(?:=|\s+)([^\s]+)/i);
      if (fromFlag?.[1]) imports.add(fromFlag[1]);
    }
  }

  return Array.from(imports);
};
