#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { applyCrossFileInference } from '../../../src/index/type-inference-crossfile.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'type-inference-crossfile-stats');
const statsRoot = path.join(tempRoot, 'stats');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(statsRoot, { recursive: true });

const writeScenarioFile = async (rootDir, relPath, contents) => {
  const absPath = path.join(rootDir, relPath);
  await fsPromises.mkdir(path.dirname(absPath), { recursive: true });
  await fsPromises.writeFile(absPath, contents);
  return absPath;
};

const runStatsScenario = async (name, { files, chunks, expect }) => {
  const scenarioRoot = path.join(statsRoot, name);
  await fsPromises.rm(scenarioRoot, { recursive: true, force: true });
  await fsPromises.mkdir(scenarioRoot, { recursive: true });
  for (const [relPath, contents] of Object.entries(files)) {
    await writeScenarioFile(scenarioRoot, relPath, contents);
  }
  const stats = await applyCrossFileInference({
    rootDir: scenarioRoot,
    chunks,
    enabled: true,
    log: () => {},
    useTooling: false,
    enableTypeInference: true,
    enableRiskCorrelation: true,
    fileRelations: null
  });
  const entries = [
    ['linkedCalls', stats.linkedCalls, expect.linkedCalls],
    ['linkedUsages', stats.linkedUsages, expect.linkedUsages],
    ['inferredReturns', stats.inferredReturns, expect.inferredReturns],
    ['riskFlows', stats.riskFlows, expect.riskFlows]
  ];
  for (const [label, actual, expected] of entries) {
    if (actual !== expected) {
      console.error(
        `Cross-file inference stats mismatch (${name}): ${label}=${actual}, expected ${expected}.`
      );
      process.exit(1);
    }
  }
};

const zeroContent = 'export function noop() { const x = 1; }\n';
await runStatsScenario('zero', {
  files: {
    'src/zero.js': zeroContent
  },
  chunks: [
    {
      file: 'src/zero.js',
      name: 'noop',
      kind: 'function',
      start: 0,
      end: zeroContent.length,
      docmeta: { returnsValue: false },
      codeRelations: {}
    }
  ],
  expect: {
    linkedCalls: 0,
    linkedUsages: 0,
    inferredReturns: 0,
    riskFlows: 0
  }
});

const creatorContent = [
  'export function makeWidget() { return {}; }',
  'export class Widget {}',
  ''
].join('\n');
const oneConsumerContent = 'export function buildWidget() { return makeWidget(); }\n';
await runStatsScenario('one-each', {
  files: {
    'src/creator.js': creatorContent,
    'src/consumer.js': oneConsumerContent
  },
  chunks: [
    {
      file: 'src/consumer.js',
      name: 'buildWidget',
      kind: 'function',
      start: 0,
      end: oneConsumerContent.length,
      docmeta: {
        returnsValue: true,
        risk: { sources: [{ name: 'source', ruleId: 'rule-source', confidence: 0.8 }] }
      },
      codeRelations: {
        calls: [['buildWidget', 'makeWidget']],
        usages: ['Widget']
      }
    },
    {
      file: 'src/creator.js',
      name: 'makeWidget',
      kind: 'function',
      start: 0,
      end: creatorContent.length,
      docmeta: {
        returnType: 'Widget',
        returnsValue: false,
        risk: {
          sinks: [{ name: 'sink', ruleId: 'rule-sink', category: 'test', severity: 'high', tags: ['taint'] }]
        }
      },
      codeRelations: {}
    },
    {
      file: 'src/creator.js',
      name: 'Widget',
      kind: 'class',
      start: 0,
      end: creatorContent.length,
      docmeta: {},
      codeRelations: {}
    }
  ],
  expect: {
    linkedCalls: 1,
    linkedUsages: 1,
    inferredReturns: 1,
    riskFlows: 1
  }
});

console.log('Cross-file inference stats ok.');

