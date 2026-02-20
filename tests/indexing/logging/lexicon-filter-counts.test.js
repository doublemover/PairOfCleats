#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  filterRawRelationsWithLexicon,
  getLexiconRelationFilterStats
} from '../../../src/index/build/file-processor/lexicon-relations-filter.js';
import { buildLexiconRelationFilterReport } from '../../../src/index/build/artifacts.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';

const rawRelations = {
  usages: ['if', 'print', 'true', 'value'],
  calls: [
    ['run', 'if'],
    ['run', 'print'],
    ['run', 'obj.value']
  ],
  callDetails: [
    { caller: 'run', callee: 'if', line: 1, col: 1 },
    { caller: 'run', callee: 'print', line: 2, col: 1 },
    { caller: 'run', callee: 'obj.value', line: 3, col: 1 }
  ],
  callDetailsWithRange: [
    { caller: 'run', callee: 'if', range: { start: 0, end: 2 } },
    { caller: 'run', callee: 'print', range: { start: 3, end: 8 } }
  ]
};

const logs = [];
const filtered = filterRawRelationsWithLexicon(rawRelations, {
  languageId: 'python',
  config: {
    enabled: true,
    relations: {
      enabled: true,
      drop: {
        keywords: true,
        literals: true,
        builtins: false,
        types: false
      }
    }
  },
  relKey: 'src/a.py',
  log: (line) => logs.push(String(line))
});

assert.equal(logs.length, 1, 'expected one deterministic filter log line');
assert.match(logs[0], /language=python/, 'expected language id in filter log line');
assert.match(logs[0], /file=src\/a\.py/, 'expected file key in filter log line');
assert.match(logs[0], /callsDropped=1/, 'expected callsDropped count');
assert.match(logs[0], /usagesDropped=2/, 'expected usagesDropped count');
assert.match(logs[0], /callDetailsDropped=1/, 'expected callDetailsDropped count');
assert.match(logs[0], /callDetailsRangeDropped=1/, 'expected callDetailsRangeDropped count');
assert.match(logs[0], /totalDropped=5/, 'expected totalDropped count');

const sparseLogs = [];
filterRawRelationsWithLexicon({
  usages: ['if', 'value'],
  calls: [['run', 'obj.value']],
  callDetails: [{ caller: 'run', callee: 'obj.value', line: 1, col: 1 }],
  callDetailsWithRange: [{ caller: 'run', callee: 'obj.value', range: { start: 0, end: 2 } }]
}, {
  languageId: 'python',
  config: {
    enabled: true,
    relations: {
      enabled: true,
      drop: {
        keywords: true,
        literals: true,
        builtins: false,
        types: false
      }
    }
  },
  relKey: 'src/b.py',
  log: (line) => sparseLogs.push(String(line))
});
assert.equal(sparseLogs.length, 1, 'expected sparse filter log line');
assert.match(sparseLogs[0], /usagesDropped=1/, 'expected usagesDropped count in sparse log');
assert.match(sparseLogs[0], /totalDropped=1/, 'expected totalDropped count in sparse log');
assert.doesNotMatch(sparseLogs[0], /callsDropped=/, 'did not expect callsDropped=0 in sparse log');
assert.doesNotMatch(sparseLogs[0], /callDetailsDropped=/, 'did not expect callDetailsDropped=0 in sparse log');
assert.doesNotMatch(sparseLogs[0], /callDetailsRangeDropped=/, 'did not expect callDetailsRangeDropped=0 in sparse log');

const zeroLogs = [];
filterRawRelationsWithLexicon({
  usages: ['value'],
  calls: [['run', 'obj.value']],
  callDetails: [{ caller: 'run', callee: 'obj.value', line: 1, col: 1 }],
  callDetailsWithRange: [{ caller: 'run', callee: 'obj.value', range: { start: 0, end: 2 } }]
}, {
  languageId: 'python',
  config: {
    enabled: true,
    relations: {
      enabled: true,
      drop: {
        keywords: true,
        literals: true,
        builtins: false,
        types: false
      }
    }
  },
  relKey: 'src/c.py',
  log: (line) => zeroLogs.push(String(line))
});
assert.equal(zeroLogs.length, 0, 'did not expect filter log line when all dropped counters are zero');

const stats = getLexiconRelationFilterStats(filtered);
assert.ok(stats, 'expected attached lexicon filter stats');
assert.equal(stats.languageId, 'python');
assert.equal(stats.file, 'src/a.py');
assert.equal(stats.droppedCalls, 1);
assert.equal(stats.droppedUsages, 2);
assert.equal(stats.droppedCallDetails, 1);
assert.equal(stats.droppedCallDetailsWithRange, 1);
assert.equal(stats.droppedTotal, 5);
assert.equal(stats.droppedCallsByCategory.keywords, 1);
assert.equal(stats.droppedUsagesByCategory.keywords, 1);
assert.equal(stats.droppedUsagesByCategory.literals, 1);

const report = buildLexiconRelationFilterReport({
  state: {
    lexiconRelationFilterByFile: new Map([
      ['src/z.py', {
        languageId: 'python',
        droppedCalls: 0,
        droppedUsages: 1,
        droppedCallDetails: 0,
        droppedCallDetailsWithRange: 0,
        droppedTotal: 1,
        droppedCallsByCategory: {
          keywords: 0,
          literals: 0,
          builtins: 0,
          types: 0
        },
        droppedUsagesByCategory: {
          keywords: 1,
          literals: 0,
          builtins: 0,
          types: 0
        }
      }],
      ['src/a.py', stats]
    ])
  },
  mode: 'code'
});

assert.equal(report.schemaVersion, 1, 'expected report schemaVersion');
assert.equal(report.mode, 'code', 'expected report mode');
assert.ok(Array.isArray(report.files), 'expected report files array');
assert.equal(report.files.length, 2, 'expected report file entries');
assert.equal(report.files[0].file, 'src/a.py', 'expected report files sorted by path');
assert.equal(report.files[1].file, 'src/z.py', 'expected report files sorted by path');
assert.equal(report.totals.files, 2, 'expected file total');
assert.equal(report.totals.droppedCalls, 1, 'expected droppedCalls total');
assert.equal(report.totals.droppedUsages, 3, 'expected droppedUsages total');
assert.equal(report.totals.droppedCallDetails, 1, 'expected droppedCallDetails total');
assert.equal(report.totals.droppedCallDetailsWithRange, 1, 'expected droppedCallDetailsWithRange total');
assert.equal(report.totals.droppedTotal, 6, 'expected droppedTotal');
const schemaResult = validateArtifact('lexicon_relation_filter_report', report);
assert.equal(schemaResult.ok, true, `expected report schema validation: ${schemaResult.errors.join('; ')}`);

console.log('lexicon filter counts test passed');
