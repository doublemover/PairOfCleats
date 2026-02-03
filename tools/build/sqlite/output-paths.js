import path from 'node:path';

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
  return { outPath, codeOutPath, proseOutPath, extractedProseOutPath, recordsOutPath };
};
