#!/usr/bin/env node
// Usage: node tools/bench/index/tree-sitter-load.js --languages javascript,go,rust --files-per-language 50 --repeats 1 --json
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { createCli } from '../../../src/shared/cli.js';
import { writeJsonWithDir } from '../micro/utils.js';
import {
  buildTreeSitterChunks,
  getTreeSitterStats,
  initTreeSitterWasm,
  preloadTreeSitterLanguages,
  resetTreeSitterParser,
  resetTreeSitterStats
} from '../../../src/lang/tree-sitter.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';

const FIXTURE_BY_LANGUAGE = {
  javascript: { relPath: path.join('tests', 'fixtures', 'tree-sitter', 'javascript.js'), ext: '.js' },
  go: { relPath: path.join('tests', 'fixtures', 'tree-sitter', 'go.go'), ext: '.go' },
  rust: { relPath: path.join('tests', 'fixtures', 'tree-sitter', 'rust.rs'), ext: '.rs' },
  python: { relPath: path.join('tests', 'fixtures', 'sample', 'src', 'sample.py'), ext: '.py' }
};

const rawArgs = process.argv.slice(2);
const cli = createCli({
  scriptName: 'tree-sitter-load',
  argv: ['node', 'tree-sitter-load', ...rawArgs],
  options: {
    languages: { type: 'string', default: 'javascript,go,rust', describe: 'Comma-separated language ids' },
    filesPerLanguage: { type: 'number', default: 50, describe: 'Synthetic files per language' },
    repeats: { type: 'number', default: 1, describe: 'Repeat parses per synthetic file' },
    useQueries: { type: 'boolean', default: true, describe: 'Enable query-based chunking' },
    warmMaxLoadedLanguages: { type: 'number', describe: 'maxLoadedLanguages for warm/cold scenario (default: languages.length)' },
    thrashMaxLoadedLanguages: { type: 'number', describe: 'maxLoadedLanguages for policy comparison (default: languages.length - 1)' },
    json: { type: 'boolean', default: false },
    out: { type: 'string', describe: 'Write JSON results to a file' }
  }
});
const argv = cli.parse();

const clampInt = (value, min, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
};

const parseLanguageList = (value) => String(value || '')
  .split(',')
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

const languages = parseLanguageList(argv.languages);
const filesPerLanguage = clampInt(argv.filesPerLanguage, 1, 50);
const repeats = clampInt(argv.repeats, 1, 1);
const useQueries = argv.useQueries !== false;
const warmMaxLoadedLanguages = clampInt(argv.warmMaxLoadedLanguages, 1, languages.length) || languages.length;
const thrashDefault = Math.max(1, languages.length - 1);
const thrashMaxLoadedLanguages = clampInt(argv.thrashMaxLoadedLanguages, 1, thrashDefault) || thrashDefault;

const root = process.cwd();

const resolveFixture = (languageId) => {
  const entry = FIXTURE_BY_LANGUAGE[languageId];
  if (!entry) {
    throw new Error(`No fixture registered for languageId=${languageId}.`);
  }
  return {
    languageId,
    ext: entry.ext,
    absPath: path.join(root, entry.relPath)
  };
};

const decorateText = (baseText, languageId, index) => {
  const comment = languageId === 'python' ? '#' : '//';
  return `${baseText}\n${comment} bench:${languageId}:${index}\n`;
};

const resetAllTreeSitterCaches = () => {
  resetTreeSitterStats();
  resetTreeSitterParser({ hard: true });
  treeSitterState.languageCache?.clear?.();
  treeSitterState.wasmLanguageCache?.clear?.();
  treeSitterState.languageLoadPromises?.clear?.();
  treeSitterState.queryCache?.clear?.();
  treeSitterState.chunkCache?.clear?.();
  treeSitterState.chunkCacheMaxEntries = null;
  treeSitterState.timeoutCounts?.clear?.();
  treeSitterState.disabledLanguages?.clear?.();
};

const buildJobs = async () => {
  const out = [];
  for (const languageId of languages) {
    const fixture = resolveFixture(languageId);
    const base = await fs.readFile(fixture.absPath, 'utf8');
    for (let i = 0; i < filesPerLanguage; i += 1) {
      out.push({
        languageId,
        ext: fixture.ext,
        text: decorateText(base, languageId, i),
        fileId: `${languageId}:${i}`
      });
    }
  }
  return out;
};

const orderJobs = (jobs, policy) => {
  if (policy === 'batch-by-language') {
    return jobs.slice().sort((a, b) => (
      a.languageId.localeCompare(b.languageId) || a.fileId.localeCompare(b.fileId)
    ));
  }

  // file-order: round-robin by synthetic index to maximize language switching.
  const groups = new Map();
  for (const job of jobs) {
    if (!groups.has(job.languageId)) groups.set(job.languageId, []);
    groups.get(job.languageId).push(job);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.fileId.localeCompare(b.fileId));
  }
  const out = [];
  for (let i = 0; i < filesPerLanguage; i += 1) {
    for (const languageId of languages) {
      const list = groups.get(languageId) || [];
      if (i < list.length) out.push(list[i]);
    }
  }
  return out;
};

const runScenario = async ({ cacheMode, policy, maxLoadedLanguages }) => {
  if (cacheMode === 'cold') {
    resetAllTreeSitterCaches();
  } else {
    resetTreeSitterStats();
  }

  const ok = await initTreeSitterWasm({ log: () => {} });
  if (!ok) {
    return {
      cacheMode,
      policy,
      maxLoadedLanguages,
      skipped: true,
      reason: 'tree-sitter wasm unavailable'
    };
  }

  const jobs = await buildJobs();
  const ordered = orderJobs(jobs, policy);
  const enabledLanguages = Object.fromEntries(languages.map((id) => [id, true]));
  const treeSitterOptions = {
    enabled: true,
    languages: enabledLanguages,
    maxLoadedLanguages,
    useQueries,
    chunkCache: false
  };

  const perLanguage = Object.fromEntries(languages.map((id) => [id, { files: 0, chunks: 0, totalMs: 0 }]));
  let totalChunks = 0;
  let totalFiles = 0;
  let fallbacks = 0;

  const start = performance.now();
  await preloadTreeSitterLanguages(languages, {
    log: () => {},
    parallel: false,
    maxLoadedLanguages,
    skipDispose: true
  });

  for (const job of ordered) {
    for (let r = 0; r < repeats; r += 1) {
      const parseStart = performance.now();
      let chunks = buildTreeSitterChunks({
        text: job.text,
        languageId: job.languageId,
        ext: job.ext,
        options: { treeSitter: treeSitterOptions, log: () => {} }
      });

      // If the grammar was evicted under a tight maxLoadedLanguages cap, reload on-demand and retry once.
      if (!Array.isArray(chunks)) {
        await preloadTreeSitterLanguages([job.languageId], {
          log: () => {},
          parallel: false,
          maxLoadedLanguages,
          skipDispose: true
        });
        chunks = buildTreeSitterChunks({
          text: job.text,
          languageId: job.languageId,
          ext: job.ext,
          options: { treeSitter: treeSitterOptions, log: () => {} }
        });
      }

      const elapsed = performance.now() - parseStart;
      perLanguage[job.languageId].totalMs += elapsed;
      perLanguage[job.languageId].files += 1;

      if (Array.isArray(chunks)) {
        const chunkCount = chunks.length;
        perLanguage[job.languageId].chunks += chunkCount;
        totalChunks += chunkCount;
      } else {
        fallbacks += 1;
      }

      totalFiles += 1;
    }
  }

  const totalMs = performance.now() - start;
  const stats = getTreeSitterStats();
  return {
    cacheMode,
    policy,
    maxLoadedLanguages,
    skipped: false,
    totalFiles,
    totalChunks,
    fallbacks,
    totalMs,
    filesPerSec: totalMs > 0 ? totalFiles / (totalMs / 1000) : 0,
    chunksPerSec: totalMs > 0 ? totalChunks / (totalMs / 1000) : 0,
    perLanguage: Object.fromEntries(
      Object.entries(perLanguage).map(([languageId, entry]) => ([
        languageId,
        {
          files: entry.files,
          chunks: entry.chunks,
          totalMs: entry.totalMs,
          filesPerSec: entry.totalMs > 0 ? entry.files / (entry.totalMs / 1000) : 0,
          chunksPerSec: entry.totalMs > 0 ? entry.chunks / (entry.totalMs / 1000) : 0
        }
      ]))
    ),
    treeSitter: stats
  };
};

const scenarios = [
  // Cold vs warm (no eviction pressure).
  await runScenario({ cacheMode: 'cold', policy: 'file-order', maxLoadedLanguages: warmMaxLoadedLanguages }),
  await runScenario({ cacheMode: 'warm', policy: 'file-order', maxLoadedLanguages: warmMaxLoadedLanguages }),

  // Policy comparison under eviction pressure.
  await runScenario({ cacheMode: 'cold', policy: 'file-order', maxLoadedLanguages: thrashMaxLoadedLanguages }),
  await runScenario({ cacheMode: 'cold', policy: 'batch-by-language', maxLoadedLanguages: thrashMaxLoadedLanguages })
];

const results = {
  generatedAt: new Date().toISOString(),
  languages,
  filesPerLanguage,
  repeats,
  useQueries,
  warmMaxLoadedLanguages,
  thrashMaxLoadedLanguages,
  scenarios
};

if (argv.out) {
  writeJsonWithDir(argv.out, results);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const scenario of scenarios) {
    if (scenario.skipped) {
      console.error(`[tree-sitter-load] ${scenario.cacheMode}/${scenario.policy} skipped: ${scenario.reason}`);
      continue;
    }
    console.error(
      `[tree-sitter-load] ${scenario.cacheMode}/${scenario.policy} ` +
      `maxLoaded=${scenario.maxLoadedLanguages} files=${scenario.totalFiles} ` +
      `ms=${scenario.totalMs.toFixed(1)} files/sec=${scenario.filesPerSec.toFixed(1)} ` +
      `wasmLoads=${scenario.treeSitter?.wasmLoads ?? 'n/a'}`
    );
  }
}

