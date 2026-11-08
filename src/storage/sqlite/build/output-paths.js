import path from 'node:path';
import fs from 'node:fs';
import { toRealPathSync } from '../../../workspace/identity.js';

const assertDistinctOutputPaths = (outputs) => {
  const identities = new Map();
  for (const [mode, output] of Object.entries(outputs)) {
    if (!output) continue;
    const resolved = toRealPathSync(output);
    const keys = [`path:${process.platform === 'win32' ? resolved.toLowerCase() : resolved}`];
    try {
      const stat = fs.statSync(resolved, { bigint: true });
      if (stat.ino > 0n) keys.push(`inode:${stat.dev}:${stat.ino}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const key of keys) {
      if (identities.has(key)) {
        const prior = identities.get(key);
        throw Object.assign(new Error(`[sqlite] Modes ${prior.mode} and ${mode} share an output database; select separate paths before building all modes: ${output}`),
          { code: 'ERR_SQLITE_DUPLICATE_OUTPUT', modes: [prior.mode, mode], paths: [prior.output, output] });
      }
      identities.set(key, { mode, output });
    }
  }
};

export const resolveOutputPaths = ({ modeArg, outArg, sqlitePaths }) => {
  let outPath = null;
  let codeOutPath = sqlitePaths.codePath;
  let proseOutPath = sqlitePaths.prosePath;
  let extractedProseOutPath = sqlitePaths.extractedProsePath;
  let recordsOutPath = sqlitePaths.recordsPath;
  if (outArg) {
    if (modeArg === 'all') {
      const outDir = outArg.endsWith('.db') ? path.dirname(outArg) : outArg;
      codeOutPath = path.join(outDir, 'index-code.db');
      proseOutPath = path.join(outDir, 'index-prose.db');
      extractedProseOutPath = path.join(outDir, 'index-extracted-prose.db');
      recordsOutPath = path.join(outDir, 'index-records.db');
    } else {
      const targetName = modeArg === 'code'
        ? 'index-code.db'
        : (modeArg === 'prose'
          ? 'index-prose.db'
          : (modeArg === 'extracted-prose'
            ? 'index-extracted-prose.db'
            : 'index-records.db'));
      outPath = outArg.endsWith('.db') ? outArg : path.join(outArg, targetName);
    }
  }
  if (!outPath && modeArg !== 'all') {
    if (modeArg === 'code') outPath = codeOutPath;
    else if (modeArg === 'prose') outPath = proseOutPath;
    else if (modeArg === 'extracted-prose') outPath = extractedProseOutPath;
    else outPath = recordsOutPath;
  }
  if (modeArg === 'all') assertDistinctOutputPaths({ code: codeOutPath, prose: proseOutPath,
    'extracted-prose': extractedProseOutPath, records: recordsOutPath });
  return { outPath, codeOutPath, proseOutPath, extractedProseOutPath, recordsOutPath };
};
