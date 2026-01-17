#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createCli } from '../src/shared/cli.js';
import { writeJsonLinesFile, writeJsonObjectFile } from '../src/shared/json-stream.js';
import { checksumFile } from '../src/shared/hash.js';
import { getIndexDir, loadUserConfig, resolveRepoRoot } from './dict-utils.js';

const argv = createCli({
  scriptName: 'compact-pieces',
  options: {
    repo: { type: 'string' },
    mode: { type: 'string', default: 'code' },
    'chunk-meta-size': { type: 'number' },
    'token-postings-size': { type: 'number' },
    'dry-run': { type: 'boolean', default: false }
  }
}).parse();

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const root = rootArg || resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(root);
const modeArg = (argv.mode || 'code').toLowerCase();
const modes = modeArg === 'all' ? ['code', 'prose', 'extracted-prose', 'records'] : [modeArg];
const dryRun = argv['dry-run'] === true;

const listShardFiles = (dir, prefix) => {
  if (!fsSync.existsSync(dir)) return [];
  return fsSync
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.jsonl'))
    .sort()
    .map((name) => path.join(dir, name));
};

const readJsonLinesFile = async (filePath, onEntry) => {
  const stream = fsSync.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const result = onEntry(JSON.parse(trimmed));
    if (result && typeof result.then === 'function') {
      await result;
    }
  }
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));

const resolveChunkMetaParts = async (indexDir) => {
  const metaPath = path.join(indexDir, 'chunk_meta.meta.json');
  const partsDir = path.join(indexDir, 'chunk_meta.parts');
  if (!fsSync.existsSync(metaPath) && !fsSync.existsSync(partsDir)) return null;
  let parts = [];
  let metaFields = null;
  if (fsSync.existsSync(metaPath)) {
    const meta = await readJson(metaPath);
    metaFields = meta.fields || meta;
    if (Array.isArray(metaFields.parts)) {
      parts = metaFields.parts.map((name) => path.join(indexDir, name));
    }
  }
  if (!parts.length) {
    parts = listShardFiles(partsDir, 'chunk_meta.part-');
  }
  if (!parts.length) return null;
  return { metaPath, partsDir, parts, metaFields };
};

const resolveTokenPostingsParts = async (indexDir) => {
  const metaPath = path.join(indexDir, 'token_postings.meta.json');
  const shardsDir = path.join(indexDir, 'token_postings.shards');
  if (!fsSync.existsSync(metaPath) && !fsSync.existsSync(shardsDir)) return null;
  let parts = [];
  let metaFields = null;
  let metaArrays = null;
  if (fsSync.existsSync(metaPath)) {
    const meta = await readJson(metaPath);
    metaFields = meta.fields || meta;
    metaArrays = meta.arrays || meta;
    if (Array.isArray(metaFields.parts)) {
      parts = metaFields.parts.map((name) => path.join(indexDir, name));
    }
  }
  if (!parts.length) {
    parts = fsSync
      .readdirSync(shardsDir)
      .filter((name) => name.startsWith('token_postings.part-') && name.endsWith('.json'))
      .sort()
      .map((name) => path.join(shardsDir, name));
  }
  if (!parts.length) return null;
  return { metaPath, shardsDir, parts, metaFields, metaArrays };
};

const appendAudit = async (indexDir, line) => {
  if (dryRun) return;
  const piecesDir = path.join(indexDir, 'pieces');
  await fs.mkdir(piecesDir, { recursive: true });
  const logPath = path.join(piecesDir, 'compaction.log');
  await fs.appendFile(logPath, `${line}\n`);
};

const replaceDirAtomic = async (sourceDir, targetDir) => {
  if (dryRun) return;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const backupDir = `${targetDir}.bak-${suffix}`;
  await fs.rm(backupDir, { recursive: true, force: true });
  const hasTarget = fsSync.existsSync(targetDir);
  if (hasTarget) {
    await fs.rename(targetDir, backupDir);
  }
  try {
    await fs.rename(sourceDir, targetDir);
    if (hasTarget) {
      await fs.rm(backupDir, { recursive: true, force: true });
    }
  } catch (err) {
    if (hasTarget) {
      try {
        await fs.rename(backupDir, targetDir);
      } catch {}
      await fs.rm(backupDir, { recursive: true, force: true });
    }
    throw err;
  }
};

const compactChunkMeta = async (indexDir, targetSize) => {
  const resolved = await resolveChunkMetaParts(indexDir);
  if (!resolved) return null;
  const { metaPath, partsDir, parts, metaFields } = resolved;
  const totalChunks = Number.isFinite(metaFields?.totalChunks) ? metaFields.totalChunks : null;
  const target = Number.isFinite(Number(targetSize)) && Number(targetSize) > 0
    ? Math.floor(Number(targetSize))
    : (Number.isFinite(metaFields?.shardSize) ? metaFields.shardSize : 100000);
  if (parts.length <= 1 || target <= 0) return null;

  const tmpDir = path.join(indexDir, 'chunk_meta.parts.compact');
  if (!dryRun) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });
  }
  const newParts = [];
  const newCounts = [];
  let buffer = [];
  let partIndex = 0;
  let total = 0;
  const flush = async () => {
    if (!buffer.length) return;
    const name = `chunk_meta.part-${String(partIndex).padStart(5, '0')}.jsonl`;
    const relPath = path.join('chunk_meta.parts', name).split(path.sep).join('/');
    const outPath = path.join(tmpDir, name);
    if (!dryRun) {
      await writeJsonLinesFile(outPath, buffer, { atomic: true });
    }
    newParts.push(relPath);
    newCounts.push(buffer.length);
    total += buffer.length;
    buffer = [];
    partIndex += 1;
  };

  for (const partPath of parts) {
    await readJsonLinesFile(partPath, async (entry) => {
      buffer.push(entry);
      if (buffer.length >= target) {
        await flush();
      }
    });
  }
  await flush();
  if (!dryRun) {
    await replaceDirAtomic(tmpDir, partsDir);
    await writeJsonObjectFile(metaPath, {
      fields: {
        format: 'jsonl',
        shardSize: target,
        totalChunks: totalChunks ?? total,
        parts: newParts
      },
      atomic: true
    });
  }
  return { type: 'chunks', name: 'chunk_meta', metaName: 'chunk_meta_meta', parts: newParts, counts: newCounts };
};

const compactTokenPostings = async (indexDir, targetSize) => {
  const resolved = await resolveTokenPostingsParts(indexDir);
  if (!resolved) return null;
  const { metaPath, shardsDir, parts, metaFields, metaArrays } = resolved;
  const target = Number.isFinite(Number(targetSize)) && Number(targetSize) > 0
    ? Math.floor(Number(targetSize))
    : (Number.isFinite(metaFields?.shardSize) ? metaFields.shardSize : 50000);
  if (parts.length <= 1 || target <= 0) return null;

  const tmpDir = path.join(indexDir, 'token_postings.shards.compact');
  if (!dryRun) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.mkdir(tmpDir, { recursive: true });
  }
  const newParts = [];
  const newCounts = [];
  let vocabBuffer = [];
  let postingsBuffer = [];
  let partIndex = 0;
  const flush = async () => {
    if (!vocabBuffer.length) return;
    const name = `token_postings.part-${String(partIndex).padStart(5, '0')}.json`;
    const relPath = path.join('token_postings.shards', name).split(path.sep).join('/');
    const outPath = path.join(tmpDir, name);
    if (!dryRun) {
      await writeJsonObjectFile(outPath, {
        arrays: { vocab: vocabBuffer, postings: postingsBuffer },
        atomic: true
      });
    }
    newParts.push(relPath);
    newCounts.push(vocabBuffer.length);
    vocabBuffer = [];
    postingsBuffer = [];
    partIndex += 1;
  };

  for (const partPath of parts) {
    const shard = await readJson(partPath);
    const vocab = Array.isArray(shard?.vocab) ? shard.vocab : (Array.isArray(shard?.arrays?.vocab) ? shard.arrays.vocab : []);
    const postings = Array.isArray(shard?.postings) ? shard.postings : (Array.isArray(shard?.arrays?.postings) ? shard.arrays.postings : []);
    for (let i = 0; i < vocab.length; i++) {
      vocabBuffer.push(vocab[i]);
      postingsBuffer.push(postings[i] || []);
      if (vocabBuffer.length >= target) {
        await flush();
      }
    }
  }
  await flush();
  const docLengths = Array.isArray(metaArrays?.docLengths) ? metaArrays.docLengths : [];
  const totalDocs = Number.isFinite(metaFields?.totalDocs) ? metaFields.totalDocs : docLengths.length;
  const avgDocLen = Number.isFinite(metaFields?.avgDocLen)
    ? metaFields.avgDocLen
    : (docLengths.length
      ? docLengths.reduce((sum, len) => sum + (Number.isFinite(len) ? len : 0), 0) / docLengths.length
      : 0);
  const vocabCount = newCounts.reduce((sum, count) => sum + count, 0);
  if (!dryRun) {
    await replaceDirAtomic(tmpDir, shardsDir);
    await writeJsonObjectFile(metaPath, {
      fields: {
        avgDocLen,
        totalDocs,
        format: 'sharded',
        shardSize: target,
        vocabCount,
        parts: newParts
      },
      arrays: { docLengths },
      atomic: true
    });
  }
  return { type: 'postings', name: 'token_postings', metaName: 'token_postings_meta', parts: newParts, counts: newCounts };
};

const updateManifest = async (indexDir, updates) => {
  if (!updates?.length) return;
  const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
  if (!fsSync.existsSync(manifestPath)) return;
  const manifestRaw = await readJson(manifestPath);
  const fields = manifestRaw.fields || manifestRaw;
  const pieces = Array.isArray(fields.pieces) ? fields.pieces : [];
  const removeNames = new Set();
  updates.forEach((update) => {
    removeNames.add(update.name);
    removeNames.add(update.metaName);
  });
  const retained = pieces.filter((piece) => !removeNames.has(piece?.name));
  const newPieces = [...retained];
  for (const update of updates) {
    for (let i = 0; i < update.parts.length; i++) {
      const relPath = update.parts[i];
      const absPath = path.join(indexDir, relPath.split('/').join(path.sep));
      const stat = await fs.stat(absPath);
      const result = await checksumFile(absPath);
      const checksum = result?.value || null;
      const checksumAlgo = result?.algo || null;
      newPieces.push({
        type: update.type,
        name: update.name,
        format: update.type === 'chunks' ? 'jsonl' : 'json',
        count: update.counts[i],
        path: relPath,
        bytes: stat.size,
        checksum: checksum && checksumAlgo ? `${checksumAlgo}:${checksum}` : null
      });
    }
    const metaRel = update.type === 'chunks' ? 'chunk_meta.meta.json' : 'token_postings.meta.json';
    const metaAbs = path.join(indexDir, metaRel);
    if (fsSync.existsSync(metaAbs)) {
      const stat = await fs.stat(metaAbs);
      const result = await checksumFile(metaAbs);
      const checksum = result?.value || null;
      const checksumAlgo = result?.algo || null;
      newPieces.push({
        type: update.type,
        name: update.metaName,
        format: 'json',
        count: null,
        path: metaRel,
        bytes: stat.size,
        checksum: checksum && checksumAlgo ? `${checksumAlgo}:${checksum}` : null
      });
    }
  }
  fields.pieces = newPieces;
  fields.generatedAt = new Date().toISOString();
  if (!dryRun) {
    await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
    await writeJsonObjectFile(manifestPath, { fields, atomic: true });
  }
};

for (const mode of modes) {
  const indexDir = getIndexDir(root, mode, userConfig);
  const chunkMetaTarget = argv['chunk-meta-size'];
  const tokenPostingsTarget = argv['token-postings-size'];
  const updates = [];
  const chunkUpdate = await compactChunkMeta(indexDir, chunkMetaTarget);
  if (chunkUpdate) {
    updates.push(chunkUpdate);
    await appendAudit(indexDir, `${new Date().toISOString()} chunk_meta compacted: parts=${chunkUpdate.parts.length}`);
  }
  const tokenUpdate = await compactTokenPostings(indexDir, tokenPostingsTarget);
  if (tokenUpdate) {
    updates.push(tokenUpdate);
    await appendAudit(indexDir, `${new Date().toISOString()} token_postings compacted: parts=${tokenUpdate.parts.length}`);
  }
  if (updates.length) {
    await updateManifest(indexDir, updates);
  }
  if (!updates.length) {
    console.log(`[pieces] ${mode}: no compaction needed.`);
  } else {
    console.log(`[pieces] ${mode}: compaction ${dryRun ? 'planned' : 'complete'}.`);
  }
}
