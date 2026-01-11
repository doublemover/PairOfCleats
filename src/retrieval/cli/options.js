import fs from 'node:fs';
import path from 'node:path';

export function getMissingFlagMessages(argv, rawArgs = []) {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  const hasMissingValue = (flag) => {
    const flagEq = `${flag}=`;
    for (let i = 0; i < args.length; i += 1) {
      const arg = String(args[i] || '');
      if (arg === flag) {
        const next = args[i + 1];
        if (next === undefined) return true;
        const nextValue = String(next);
        if (!nextValue.trim() || nextValue.startsWith('-')) return true;
        continue;
      }
      if (arg.startsWith(flagEq)) {
        const value = arg.slice(flagEq.length);
        if (!String(value).trim()) return true;
      }
    }
    return false;
  };

  const missingValueFlags = [
    { key: 'type', flag: '--type', example: '--type Function' },
    { key: 'author', flag: '--author', example: '--author "Jane Doe"' },
    { key: 'import', flag: '--import', example: '--import lodash' }
  ];
  return missingValueFlags
    .filter((entry) => {
      const value = argv?.[entry.key];
      if (value === true) return true;
      if (typeof value === 'string' && !value.trim()) return true;
      if (value === undefined && hasMissingValue(entry.flag)) return true;
      return false;
    })
    .map((entry) => `Missing value for ${entry.flag}. Example: ${entry.example}`);
}

export function estimateIndexBytes(indexDir) {
  if (!indexDir || !fs.existsSync(indexDir)) return 0;
  const targets = [
    'chunk_meta.json',
    'chunk_meta.jsonl',
    'chunk_meta.meta.json',
    'token_postings.json',
    'token_postings.meta.json',
    'phrase_ngrams.json',
    'chargram_postings.json',
    'dense_vectors_uint8.json',
    'filter_index.json'
  ];
  const sumFile = (targetPath) => {
    try {
      const stat = fs.statSync(targetPath);
      return stat.size;
    } catch {
      return 0;
    }
  };
  let total = 0;
  for (const name of targets) {
    total += sumFile(path.join(indexDir, name));
  }
  const chunkMetaPartsDir = path.join(indexDir, 'chunk_meta.parts');
  if (fs.existsSync(chunkMetaPartsDir)) {
    for (const entry of fs.readdirSync(chunkMetaPartsDir)) {
      total += sumFile(path.join(chunkMetaPartsDir, entry));
    }
  }
  const tokenPostingsShardsDir = path.join(indexDir, 'token_postings.shards');
  if (fs.existsSync(tokenPostingsShardsDir)) {
    for (const entry of fs.readdirSync(tokenPostingsShardsDir)) {
      total += sumFile(path.join(tokenPostingsShardsDir, entry));
    }
  }
  return total;
}

export function resolveIndexedFileCount(metricsRoot, modeFlags) {
  if (!metricsRoot || !fs.existsSync(metricsRoot)) return null;
  const modes = [];
  if (modeFlags?.runCode) modes.push('code');
  if (modeFlags?.runProse) modes.push('prose');
  if (modeFlags?.runExtractedProse) modes.push('extracted-prose');
  if (!modes.length) return null;
  const counts = [];
  for (const mode of modes) {
    const metricsPath = path.join(metricsRoot, `index-${mode}.json`);
    if (!fs.existsSync(metricsPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
      const count = Number(raw?.files?.candidates);
      if (Number.isFinite(count) && count > 0) counts.push(count);
    } catch {
      // ignore
    }
  }
  if (!counts.length) return null;
  return Math.max(...counts);
}

export function resolveBm25Defaults(metricsRoot, modeFlags) {
  if (!metricsRoot || !fs.existsSync(metricsRoot)) return null;
  const targets = [];
  if (modeFlags?.runCode) targets.push('code');
  if (modeFlags?.runProse) targets.push('prose');
  if (modeFlags?.runExtractedProse) targets.push('extracted-prose');
  if (!targets.length) return null;
  const values = [];
  for (const mode of targets) {
    const metricsPath = path.join(metricsRoot, `index-${mode}.json`);
    if (!fs.existsSync(metricsPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
      const k1 = Number(raw?.bm25?.k1);
      const b = Number(raw?.bm25?.b);
      if (Number.isFinite(k1) && Number.isFinite(b)) values.push({ k1, b });
    } catch {
      // ignore
    }
  }
  if (!values.length) return null;
  const k1 = values.reduce((sum, v) => sum + v.k1, 0) / values.length;
  const b = values.reduce((sum, v) => sum + v.b, 0) / values.length;
  return { k1, b };
}

export function loadBranchFromMetrics(metricsDir, mode) {
  try {
    const metricsPath = path.join(metricsDir, `index-${mode}.json`);
    if (!fs.existsSync(metricsPath)) return null;
    const raw = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
    return raw?.git?.branch || null;
  } catch {
    return null;
  }
}
