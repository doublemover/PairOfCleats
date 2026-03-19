#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildBenchRunDiff } from '../../../tools/bench/language/diff.js';

const before = {
  generatedAt: '2026-03-17T00:00:00.000Z',
  methodology: {
    mode: 'warm',
    cacheMode: 'warm',
    toolingMode: 'disabled',
    corpusVersion: 'repos-a',
    policyVersion: 'bench-language-methodology-v1'
  },
  tasks: [
    {
      language: 'javascript',
      tier: 'small',
      repo: 'org/js',
      summary: {
        hitRate: { memory: 0.9, sqlite: 0.8 },
        buildMs: { index: 100 }
      },
      taskStatus: {
        resultClass: 'passed',
        degradationClasses: []
      },
      diagnostics: {
        process: {
          countsByType: {
            artifact_tail_stall: 1
          }
        }
      }
    }
  ]
};

const after = {
  generatedAt: '2026-03-18T00:00:00.000Z',
  methodology: {
    mode: 'cold',
    cacheMode: 'cold',
    toolingMode: 'disabled',
    corpusVersion: 'repos-a',
    policyVersion: 'bench-language-methodology-v1'
  },
  tasks: [
    {
      language: 'javascript',
      tier: 'small',
      repo: 'org/js',
      summary: {
        hitRate: { memory: 0.5, sqlite: 0.4 },
        buildMs: { index: 180 }
      },
      taskStatus: {
        resultClass: 'timed_out',
        degradationClasses: ['artifact_tail_stall']
      },
      diagnostics: {
        process: {
          countsByType: {
            artifact_tail_stall: 3
          }
        }
      }
    }
  ]
};

const diff = buildBenchRunDiff({ before, after });
assert.equal(diff.schemaVersion, 1, 'expected diff schema version');
assert.equal(diff.byLanguage.length, 1, 'expected one language diff row');
assert.equal(diff.byRepo.length, 1, 'expected one repo diff row');
assert.equal(diff.byRepo[0]?.buildIndexMs?.delta, 80, 'expected build index delta');
assert.equal(diff.byRepo[0]?.timeoutCount?.after, 1, 'expected timeout count in after report');
assert.equal(diff.byRepo[0]?.artifactTailStallCount?.delta, 2, 'expected artifact-tail-stall delta');
assert.equal(diff.byRepo[0]?.cacheHitRate?.delta, -0.4, 'expected cache hit rate delta');

console.log('bench language run diff test passed');
