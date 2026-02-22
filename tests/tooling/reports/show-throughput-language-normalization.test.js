#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'reports', 'show-throughput.js');
const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'show-throughput-lang-normalize-'));
const runRoot = path.join(tmpRoot, 'workspace');
const resultsRoot = path.join(runRoot, 'benchmarks', 'results');
await fsPromises.mkdir(path.join(resultsRoot, 'mixed'), { recursive: true });

const fixture = {
  repo: {
    root: 'C:/repo'
  },
  summary: {
    buildMs: { index: 10, sqlite: 20 },
    queryWallMsPerQuery: 2,
    queryWallMsPerSearch: 3,
    latencyMs: {
      memory: { mean: 1, p95: 2 },
      sqlite: { mean: 2, p95: 3 }
    }
  },
  artifacts: {
    repo: {
      root: 'C:/repo'
    },
    throughput: {
      code: {
        files: 1,
        chunks: 1,
        tokens: 10,
        bytes: 128,
        totalMs: 1000,
        filesPerSec: 1,
        chunksPerSec: 1,
        tokensPerSec: 10,
        bytesPerSec: 128
      }
    },
    indexing: {
      schemaVersion: 1,
      generatedAt: '2026-02-22T00:00:00.000Z',
      source: 'feature-metrics',
      modes: {
        code: {
          files: 1,
          lines: 87,
          bytes: 256,
          durationMs: 1000,
          linesPerSec: 87
        },
        prose: {
          files: 0,
          lines: 0,
          bytes: 0,
          durationMs: 0,
          linesPerSec: null
        },
        'extracted-prose': {
          files: 0,
          lines: 0,
          bytes: 0,
          durationMs: 0,
          linesPerSec: null
        },
        records: {
          files: 0,
          lines: 0,
          bytes: 0,
          durationMs: 0,
          linesPerSec: null
        }
      },
      totals: {
        files: 1,
        lines: 87,
        bytes: 256,
        durationMs: 1000,
        linesPerSec: 87
      },
      languageLines: {
        '{.python}': 15,
        '{.xml}': 1,
        '{.haskell}': 63,
        hs: 6,
        unknown: 2
      }
    }
  }
};

await fsPromises.writeFile(
  path.join(resultsRoot, 'mixed', 'fixture.json'),
  JSON.stringify(fixture, null, 2)
);

const stripAnsi = (value) => String(value || '').replace(/\u001b\[[0-9;]*m/g, '');

const result = spawnSync(
  process.execPath,
  [scriptPath],
  { cwd: runRoot, encoding: 'utf8' }
);
assert.equal(result.status, 0, result.stderr || result.stdout);

const output = stripAnsi(result.stderr);
const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const languageSummaryLine = lines.find((line) => line.startsWith('Lines by Language (top ')) || '';

assert.equal(lines.some((line) => line.includes('{.python}')), false, 'expected pandoc language tags to be normalized');
assert.equal(lines.some((line) => line.includes('{.xml}')), false, 'expected pandoc extension tags to be normalized');
assert.equal(lines.some((line) => /^hs:\s+/i.test(line)), false, 'expected hs alias to normalize to haskell');
assert.equal(languageSummaryLine.includes('python 15'), true, 'expected python lines to be preserved');
assert.equal(languageSummaryLine.includes('xml 1'), true, 'expected xml lines to be preserved');
assert.equal(languageSummaryLine.includes('haskell 69'), true, 'expected haskell aliases to merge into one bucket');
assert.equal(languageSummaryLine.includes('unknown 2'), true, 'expected unresolved languages to remain explicitly tracked');

await fsPromises.rm(tmpRoot, { recursive: true, force: true });

console.log('show-throughput language normalization test passed');
