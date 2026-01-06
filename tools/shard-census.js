#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createCli } from '../src/shared/cli.js';
import { loadUserConfig } from './dict-utils.js';
import { buildIgnoreMatcher } from '../src/index/build/ignore.js';
import { discoverFilesForModes } from '../src/index/build/discover.js';
import { planShards } from '../src/index/build/shards.js';
import { runWithConcurrency } from '../src/shared/concurrency.js';
import { toPosix } from '../src/shared/files.js';

const argv = createCli({
  scriptName: 'shard-census',
  usage: 'Usage: shard-census --repo <path> | --bench',
  options: {
    bench: { type: 'boolean', default: false },
    repo: { type: 'string' }
  }
}).parse();

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const benchConfigPath = path.join(scriptRoot, 'benchmarks', 'repos.json');
const benchReposRoot = path.join(scriptRoot, 'benchmarks', 'repos');

const normalizeLimit = (value, fallback) => {
  if (value === 0 || value === false) return null;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return fallback;
};

const normalizeDepth = (value, fallback) => {
  if (value === 0) return 0;
  if (value === false) return null;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return fallback;
};

const normalizeCapValue = (value) => {
  if (value === 0 || value === false) return null;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return null;
};

const normalizeCapEntry = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {};
  const maxBytes = normalizeCapValue(input.maxBytes);
  const maxLines = normalizeCapValue(input.maxLines);
  return { maxBytes, maxLines };
};

const normalizeCapsByExt = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {};
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    const entry = normalizeCapEntry(value);
    if (entry.maxBytes == null && entry.maxLines == null) continue;
    const normalizedKey = key.startsWith('.') ? key.toLowerCase() : `.${key.toLowerCase()}`;
    output[normalizedKey] = entry;
  }
  return output;
};

const normalizeCapsByLanguage = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {};
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    const entry = normalizeCapEntry(value);
    if (entry.maxBytes == null && entry.maxLines == null) continue;
    output[key.toLowerCase()] = entry;
  }
  return output;
};

const resolveMaxFileBytes = (indexingConfig) => {
  const maxFileBytesRaw = indexingConfig?.maxFileBytes;
  const maxFileBytesParsed = Number(maxFileBytesRaw);
  if (maxFileBytesRaw === false || maxFileBytesRaw === 0) {
    return null;
  }
  if (Number.isFinite(maxFileBytesParsed) && maxFileBytesParsed > 0) {
    return maxFileBytesParsed;
  }
  return 5 * 1024 * 1024;
};

const resolveFileCaps = (indexingConfig) => {
  const fileCapsConfig = indexingConfig?.fileCaps || {};
  return {
    default: normalizeCapEntry(fileCapsConfig.default || fileCapsConfig.defaults || {}),
    byExt: normalizeCapsByExt(fileCapsConfig.byExt || fileCapsConfig.byExtension),
    byLanguage: normalizeCapsByLanguage(fileCapsConfig.byLanguage || fileCapsConfig.byLang)
  };
};

const resolveShardConfig = (indexingConfig) => {
  const shardsConfig = indexingConfig?.shards || {};
  return {
    enabled: shardsConfig.enabled === true,
    maxShards: normalizeLimit(shardsConfig.maxShards, null),
    minFiles: normalizeLimit(shardsConfig.minFiles, null),
    dirDepth: normalizeDepth(shardsConfig.dirDepth, 3)
  };
};

const countLines = async (filePath) => {
  try {
    const buf = await fsPromises.readFile(filePath);
    if (!buf || !buf.length) return 0;
    let count = 0;
    for (const byte of buf) {
      if (byte === 10) count += 1;
    }
    return count + 1;
  } catch {
    return 0;
  }
};

const loadBenchConfig = async () => {
  const raw = await fsPromises.readFile(benchConfigPath, 'utf8');
  return JSON.parse(raw);
};

const buildBenchTasks = (config) => {
  const tasks = [];
  for (const [language, entry] of Object.entries(config || {})) {
    const repos = entry?.repos || {};
    for (const tier of Object.keys(repos)) {
      const list = Array.isArray(repos[tier]) ? repos[tier] : [];
      for (const repo of list) {
        tasks.push({ language, repo, tier });
      }
    }
  }
  return tasks;
};

const resolveRepoPath = async (repoArg) => {
  if (!repoArg) return null;
  const direct = path.resolve(repoArg);
  if (fs.existsSync(direct)) return direct;
  if (!repoArg.includes('/')) return null;
  const config = await loadBenchConfig();
  const matches = [];
  for (const [language, entry] of Object.entries(config || {})) {
    const repos = entry?.repos || {};
    for (const list of Object.values(repos)) {
      if (!Array.isArray(list)) continue;
      if (list.includes(repoArg)) {
        matches.push(path.join(benchReposRoot, language, repoArg));
      }
    }
  }
  if (matches.length === 1) return matches[0];
  return null;
};

const formatNumber = (value) => value.toLocaleString('en-US');

const censusRepo = async (repoPath, label) => {
  const userConfig = loadUserConfig(repoPath);
  const indexingConfig = userConfig.indexing || {};
  const maxFileBytes = resolveMaxFileBytes(indexingConfig);
  const fileCaps = resolveFileCaps(indexingConfig);
  const shardConfig = resolveShardConfig(indexingConfig);
  const { ignoreMatcher } = await buildIgnoreMatcher({ root: repoPath, userConfig });

  const modes = ['code', 'prose'];
  const skippedByMode = { code: [], prose: [] };
  const entriesByMode = await discoverFilesForModes({
    root: repoPath,
    modes,
    ignoreMatcher,
    skippedByMode,
    maxFileBytes,
    fileCaps
  });

  const concurrency = Math.max(1, Math.min(32, os.cpus().length * 2));
  console.log(`\n${label}`);
  console.log(`Repo: ${repoPath}`);
  for (const mode of modes) {
    const entries = entriesByMode[mode] || [];
    if (!entries.length) {
      console.log(`Mode ${mode}: no files`);
      continue;
    }
    const lineCounts = new Map();
    await runWithConcurrency(
      entries,
      concurrency,
      async (entry) => {
        const lines = await countLines(entry.abs);
        lineCounts.set(toPosix(entry.rel), lines);
      },
      { collectResults: false }
    );
    const shards = planShards(entries, {
      mode,
      maxShards: shardConfig.maxShards,
      minFiles: shardConfig.minFiles,
      dirDepth: shardConfig.dirDepth
    });
    const shardStats = shards.map((shard) => {
      let lines = 0;
      for (const entry of shard.entries) {
        lines += lineCounts.get(toPosix(entry.rel)) || 0;
      }
      return {
        id: shard.id,
        label: shard.label || shard.id,
        files: shard.entries.length,
        lines
      };
    });
    shardStats.sort((a, b) => {
      if (b.lines !== a.lines) return b.lines - a.lines;
      if (b.files !== a.files) return b.files - a.files;
      return a.label.localeCompare(b.label);
    });
    const totalFiles = entries.length;
    const totalLines = shardStats.reduce((sum, shard) => sum + shard.lines, 0);
    console.log(
      `Mode ${mode}: ${shardStats.length} shards, ${formatNumber(totalFiles)} files, ${formatNumber(totalLines)} lines`
    );
    for (const shard of shardStats) {
      console.log(
        `- ${shard.label} | files ${formatNumber(shard.files)} | lines ${formatNumber(shard.lines)}`
      );
    }
  }
};

const main = async () => {
  if (argv.bench && argv.repo) {
    console.error('Use either --bench or --repo, not both.');
    process.exit(1);
  }
  if (!argv.bench && !argv.repo) {
    console.error('Missing --bench or --repo.');
    process.exit(1);
  }
  if (argv.bench) {
    const config = await loadBenchConfig();
    const tasks = buildBenchTasks(config);
    let missing = 0;
    for (const task of tasks) {
      const repoPath = path.join(benchReposRoot, task.language, task.repo);
      const label = `${task.language}/${task.repo}`;
      if (!fs.existsSync(repoPath)) {
        console.error(`Missing ${label} at ${repoPath}`);
        missing += 1;
        continue;
      }
      await censusRepo(repoPath, label);
    }
    if (missing) {
      console.error(`Skipped ${missing} repos (missing on disk).`);
    }
    return;
  }

  const repoPath = await resolveRepoPath(argv.repo);
  if (!repoPath || !fs.existsSync(repoPath)) {
    console.error(`Repo not found: ${argv.repo}`);
    process.exit(1);
  }
  await censusRepo(repoPath, `repo ${argv.repo}`);
};

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
