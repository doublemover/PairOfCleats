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
    { key: 'repo', flag: '--repo', example: '--repo .' },
    { key: 'filter', flag: '--filter', example: '--filter "lang:js"' },
    { key: 'type', flag: '--type', example: '--type Function' },
    { key: 'author', flag: '--author', example: '--author "Jane Doe"' },
    { key: 'import', flag: '--import', example: '--import lodash' },
    { key: 'chunk-author', flag: '--chunk-author', example: '--chunk-author "Jane Doe"' },
    { key: 'lang', flag: '--lang', example: '--lang typescript' },
    { key: 'ext', flag: '--ext', example: '--ext .ts' },
    { key: 'path', flag: '--path', example: '--path src/index' },
    { key: 'file', flag: '--file', example: '--file src/index.js' },
    { key: 'branch', flag: '--branch', example: '--branch main' },
    { key: 'meta', flag: '--meta', example: '--meta visibility=public' },
    { key: 'meta-json', flag: '--meta-json', example: '--meta-json \'[{"key":"value"}]\'' },
    { key: 'calls', flag: '--calls', example: '--calls fetch' },
    { key: 'uses', flag: '--uses', example: '--uses File' },
    { key: 'signature', flag: '--signature', example: '--signature "fn("'},
    { key: 'param', flag: '--param', example: '--param request' },
    { key: 'decorator', flag: '--decorator', example: '--decorator memoize' },
    { key: 'inferred-type', flag: '--inferred-type', example: '--inferred-type string' },
    { key: 'return-type', flag: '--return-type', example: '--return-type boolean' },
    { key: 'throws', flag: '--throws', example: '--throws Error' },
    { key: 'reads', flag: '--reads', example: '--reads config' },
    { key: 'writes', flag: '--writes', example: '--writes cache' },
    { key: 'mutates', flag: '--mutates', example: '--mutates state' },
    { key: 'alias', flag: '--alias', example: '--alias foo=bar' },
    { key: 'awaits', flag: '--awaits', example: '--awaits fetch' },
    { key: 'visibility', flag: '--visibility', example: '--visibility public' },
    { key: 'extends', flag: '--extends', example: '--extends Base' },
    { key: 'risk', flag: '--risk', example: '--risk high' },
    { key: 'risk-tag', flag: '--risk-tag', example: '--risk-tag sql' },
    { key: 'risk-source', flag: '--risk-source', example: '--risk-source user' },
    { key: 'risk-sink', flag: '--risk-sink', example: '--risk-sink db' },
    { key: 'risk-category', flag: '--risk-category', example: '--risk-category injection' },
    { key: 'risk-flow', flag: '--risk-flow', example: '--risk-flow user->db' },
    { key: 'struct-pack', flag: '--struct-pack', example: '--struct-pack core' },
    { key: 'struct-rule', flag: '--struct-rule', example: '--struct-rule no-circular' },
    { key: 'struct-tag', flag: '--struct-tag', example: '--struct-tag api' },
    { key: 'modified-after', flag: '--modified-after', example: '--modified-after 2025-01-01' },
    { key: 'modified-since', flag: '--modified-since', example: '--modified-since 30' },
    { key: 'churn', flag: '--churn', example: '--churn 10' },
    { key: 'bm25-k1', flag: '--bm25-k1', example: '--bm25-k1 1.2' },
    { key: 'bm25-b', flag: '--bm25-b', example: '--bm25-b 0.75' },
    { key: 'fts-profile', flag: '--fts-profile', example: '--fts-profile balanced' },
    { key: 'fts-weights', flag: '--fts-weights', example: '--fts-weights 0.2,1.5,1.2,0.6,1.5,1.8,1.0' },
    { key: 'ann-backend', flag: '--ann-backend', example: '--ann-backend lancedb' },
    { key: 'backend', flag: '--backend', example: '--backend auto' },
    { key: 'model', flag: '--model', example: '--model Xenova/all-MiniLM-L6-v2' },
    { key: 'graph-ranking-max-work', flag: '--graph-ranking-max-work', example: '--graph-ranking-max-work 5000' },
    { key: 'graph-ranking-max-ms', flag: '--graph-ranking-max-ms', example: '--graph-ranking-max-ms 250' },
    { key: 'graph-ranking-seeds', flag: '--graph-ranking-seeds', example: '--graph-ranking-seeds top1' },
    { key: 'graph-ranking-seed-k', flag: '--graph-ranking-seed-k', example: '--graph-ranking-seed-k 3' }
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
  if (modeFlags?.runRecords) modes.push('records');
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
  if (modeFlags?.runRecords) targets.push('records');
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
