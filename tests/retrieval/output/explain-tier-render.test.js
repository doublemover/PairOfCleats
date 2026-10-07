#!/usr/bin/env node
import assert from 'node:assert/strict';
import { formatFullChunk } from '../../../src/retrieval/output/format/full.js';
import { color } from '../../../src/retrieval/cli/ansi.js';
import { stripAnsi } from '../../../src/shared/cli/ansi-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const chunk = {
  file: 'src/retrieval/output/explain.js',
  name: 'formatScoreBreakdown',
  kind: 'Function',
  start: 0,
  end: 1,
  startLine: 159,
  endLine: 224,
  last_modified: '2026-02-17T19:53:00.000Z',
  chunk_authors: ['doublemover', '2xmvr'],
  last_author: '2xmvr',
  docmeta: {
    signature: 'formatScoreBreakdown(scoreBreakdown, color)',
    commentExcerpt: 'Parse trust/confidence surface while ignoring unknown forward fields.',
    inferredTypes: {
      params: {
        scoreBreakdown: [{ type: 'any', source: 'tooling', confidence: 0.5 }]
      },
      locals: {
        parts: [{ type: 'array', source: 'literal', confidence: 0.6 }]
      }
    },
    dataflow: {
      reads: ['scoreBreakdown', 'selected', 'Number', 'color', 'formatScorePiece'],
      writes: ['parts', 'selected', 'entry', 'piece', 'sparse', 'ann'],
      aliases: ['selected->entry']
    }
  },
  codeRelations: {
    calls: [
      ['formatScoreBreakdown', 'entry.push'],
      ['formatScoreBreakdown', 'entry.push'],
      ['formatScoreBreakdown', 'formatScorePiece']
    ],
    callSummaries: [
      { name: 'entry.push', args: ['selected.type'], returnTypes: [] }
    ]
  },
  scoreBreakdown: {
    selected: { type: 'fts', score: 15.985 },
    sparse: { type: 'fts', score: 13.321 },
    symbol: { definition: true, export: false, factor: 1.2 }
  }
};

const summary = stripAnsi(formatFullChunk({
  chunk,
  index: 0,
  mode: 'code',
  score: 1,
  scoreType: 'fts',
  explain: true,
  explainTier: 'summary',
  color,
  layout: { columns: 72, contentWidth: 68, cacheKey: 'cols:72' },
  _skipCache: true
}));

const full = stripAnsi(formatFullChunk({
  chunk,
  index: 0,
  mode: 'code',
  score: 1,
  scoreType: 'fts',
  explain: true,
  explainTier: 'full',
  color,
  layout: { columns: 72, contentWidth: 68, cacheKey: 'cols:72' },
  _skipCache: true
}));

assert.match(summary, /Scores: Score=fts,15\.985/);
assert.match(summary, /Reads:/);
assert.doesNotMatch(summary, /Authors:/);
assert.doesNotMatch(summary, /Inferred Locals:/);
assert.doesNotMatch(summary, /Aliases:/);

assert.match(full, /Authors:/);
assert.match(full, /Inferred Locals:/);
assert.match(full, /Aliases:/);
assert.match(full, /Call Summary:/);

console.log('explain tier render test passed');
