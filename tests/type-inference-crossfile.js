#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';
import { applyCrossFileInference } from '../src/index/type-inference-crossfile.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'type-inference-crossfile');
const repoRoot = path.join(tempRoot, 'repo');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });

const statsRoot = path.join(tempRoot, 'stats');
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

const secondConsumerContent = 'export function buildWidgetTwo() { return makeWidget(); }\n';
await runStatsScenario('couple-each', {
  files: {
    'src/creator.js': creatorContent,
    'src/consumer-one.js': oneConsumerContent,
    'src/consumer-two.js': secondConsumerContent
  },
  chunks: [
    {
      file: 'src/consumer-one.js',
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
      file: 'src/consumer-two.js',
      name: 'buildWidgetTwo',
      kind: 'function',
      start: 0,
      end: secondConsumerContent.length,
      docmeta: {
        returnsValue: true,
        risk: { sources: [{ name: 'source', ruleId: 'rule-source', confidence: 0.8 }] }
      },
      codeRelations: {
        calls: [['buildWidgetTwo', 'makeWidget']],
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
    linkedCalls: 2,
    linkedUsages: 2,
    inferredReturns: 2,
    riskFlows: 2
  }
});

const config = {
  indexing: {
    typeInference: true,
    typeInferenceCrossFile: true
  },
  sqlite: { use: false }
};
await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify(config, null, 2)
);

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'creator.js'),
  `/**
 * @returns {Widget}
 */
export function createWidget() {
  return new Widget();
}

export class Widget {
  constructor() {
    this.id = 1;
  }
}
`
);

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'consumer.js'),
  `import { createWidget, Widget } from './creator.js';

export function buildWidget() {
  const widget = new Widget();
  return createWidget();
}
`
);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: path.join(tempRoot, 'cache'),
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_CACHE_ROOT = env.PAIROFCLEATS_CACHE_ROOT;
process.env.PAIROFCLEATS_EMBEDDINGS = env.PAIROFCLEATS_EMBEDDINGS;

const result = spawnSync(process.execPath, [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot], {
  cwd: repoRoot,
  env,
  stdio: 'inherit'
});
if (result.status !== 0) {
  console.error('Cross-file inference test failed: build_index failed.');
  process.exit(result.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
const chunkMetaPath = path.join(codeDir, 'chunk_meta.json');
if (!fs.existsSync(chunkMetaPath)) {
  console.error(`Missing chunk meta at ${chunkMetaPath}`);
  process.exit(1);
}

const chunkMeta = JSON.parse(fs.readFileSync(chunkMetaPath, 'utf8'));
const fileMetaPath = path.join(codeDir, 'file_meta.json');
const fileMeta = fs.existsSync(fileMetaPath)
  ? JSON.parse(fs.readFileSync(fileMetaPath, 'utf8'))
  : [];
const fileById = new Map(
  (Array.isArray(fileMeta) ? fileMeta : []).map((entry) => [entry.id, entry.file])
);
const resolveChunkFile = (chunk) => chunk?.file || fileById.get(chunk?.fileId) || null;

const buildWidget = chunkMeta.find((chunk) =>
  resolveChunkFile(chunk) === 'src/consumer.js' &&
  chunk.name === 'buildWidget'
);
if (!buildWidget) {
  console.error('Missing buildWidget chunk in consumer.js.');
  process.exit(1);
}

const inferredReturns = buildWidget.docmeta?.inferredTypes?.returns || [];
if (!inferredReturns.some((entry) => entry.type === 'Widget' && entry.source === 'flow')) {
  console.error('Cross-file inference missing return type Widget for buildWidget.');
  process.exit(1);
}

const callLinks = buildWidget.codeRelations?.callLinks || [];
if (!callLinks.some((link) => link.target === 'createWidget' && link.file === 'src/creator.js')) {
  console.error('Cross-file inference missing call link to createWidget.');
  process.exit(1);
}
const callLink = callLinks.find((link) => link.target === 'createWidget' && link.file === 'src/creator.js');
if (!callLink?.returnTypes?.includes('Widget')) {
  console.error('Cross-file inference missing returnTypes for createWidget call link.');
  process.exit(1);
}

const callSummaries = buildWidget.codeRelations?.callSummaries || [];
const callSummary = callSummaries.find((link) => link.target === 'createWidget' && link.file === 'src/creator.js');
if (!callSummary?.returnTypes?.includes('Widget')) {
  console.error('Cross-file inference missing call summary returnTypes for createWidget.');
  process.exit(1);
}

const usageLinks = buildWidget.codeRelations?.usageLinks || [];
if (!usageLinks.some((link) => link.target === 'Widget' && link.file === 'src/creator.js')) {
  console.error('Cross-file inference missing usage link to Widget.');
  process.exit(1);
}

console.log('Cross-file inference test passed');
