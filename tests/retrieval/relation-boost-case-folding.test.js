#!/usr/bin/env node
import assert from 'node:assert/strict';
import { computeRelationBoost } from '../../src/retrieval/scoring/relation-boost.js';
import {
  createRelationBoostIndex,
  createRelationBoostPipeline
} from './helpers/relation-boost-fixture.js';

const chunk = {
  lang: 'javascript',
  file: 'src/Foo.js',
  codeRelations: {
    calls: [['run', 'RenderWidget']],
    usages: ['RenderWidget']
  }
};

const folded = computeRelationBoost({
  chunk,
  queryTokens: ['renderwidget'],
  config: { enabled: true, caseTokens: false, perCall: 0.25, perUse: 0.1, maxBoost: 1.5 }
});
const strict = computeRelationBoost({
  chunk,
  queryTokens: ['renderwidget'],
  config: { enabled: true, caseTokens: true, perCall: 0.25, perUse: 0.1, maxBoost: 1.5 }
});

assert.equal(folded.callMatches, 1, 'expected case-folded call match');
assert.equal(folded.usageMatches, 1, 'expected case-folded usage match');
assert.equal(strict.callMatches, 0, 'expected case-sensitive call mismatch');
assert.equal(strict.usageMatches, 0, 'expected case-sensitive usage mismatch');

const idx = createRelationBoostIndex({
  chunks: [{
    id: 0,
    file: 'src/foo.js',
    lang: 'javascript',
    tokens: ['alpha'],
    codeRelations: {}
  }],
  fileRelations: new Map([
    ['src/FOO.js', { usages: ['AlphaUsage'] }]
  ])
});

const caseInsensitiveFilePipeline = createRelationBoostPipeline({
  query: 'AlphaUsage',
  queryTokens: ['alphausage'],
  filters: { caseFile: false, caseTokens: false },
  relationBoost: { enabled: true, perCall: 0.25, perUse: 0.1, maxBoost: 1.5 },
  rankSqliteFts: () => [{ idx: 0, score: 1 }]
});
const caseSensitiveFilePipeline = createRelationBoostPipeline({
  query: 'AlphaUsage',
  queryTokens: ['alphausage'],
  filters: { caseFile: true, caseTokens: false },
  relationBoost: { enabled: true, perCall: 0.25, perUse: 0.1, maxBoost: 1.5 },
  rankSqliteFts: () => [{ idx: 0, score: 1 }]
});

const insensitiveHit = (await caseInsensitiveFilePipeline(idx, 'code', null))[0];
const sensitiveHit = (await caseSensitiveFilePipeline(idx, 'code', null))[0];

assert.equal(
  insensitiveHit?.scoreBreakdown?.relation?.usageMatches,
  1,
  'expected file-relation lookup to be case-insensitive when caseFile=false'
);
assert.equal(
  sensitiveHit?.scoreBreakdown?.relation?.usageMatches,
  0,
  'expected file-relation lookup to require exact case when caseFile=true'
);

console.log('relation boost case-folding test passed');
