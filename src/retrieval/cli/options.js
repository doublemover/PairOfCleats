import fs from 'node:fs';
import path from 'node:path';

export function getMissingFlagMessages(argv) {
  const missingValueFlags = [
    { name: 'type', example: '--type Function' },
    { name: 'author', example: '--author "Jane Doe"' },
    { name: 'import', example: '--import lodash' }
  ];
  return missingValueFlags
    .filter((entry) => {
      const value = argv[entry.name];
      return value === true || (typeof value === 'string' && !value.trim());
    })
    .map((entry) => `Missing value for --${entry.name}. Example: ${entry.example}`);
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
