#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { applyCrossFileInference } from '../../../src/index/type-inference-crossfile.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'type-inference-crossfile-stats');
const statsRoot = path.join(tempRoot, 'stats');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(statsRoot, { recursive: true });

const buildSymbolMeta = ({ file, name, kind, chunkUid }) => {
  const kindGroup = String(kind || '').toLowerCase().includes('class') ? 'class' : 'function';
  return {
    chunkUid,
    file,
    name,
    kind,
    symbol: {
      v: 1,
      scheme: 'heur',
      kindGroup,
      qualifiedName: name,
      symbolKey: `${file}::${name}::${kindGroup}`,
      signatureKey: null,
      scopedId: `${kindGroup}|${file}::${name}::${kindGroup}|${chunkUid}`,
      symbolId: `sym1:heur:${chunkUid}`
    }
  };
};

const writeScenarioFile = async (rootDir, relPath, contents) => {
  const absPath = path.join(rootDir, relPath);
  await fsPromises.mkdir(path.dirname(absPath), { recursive: true });
  await fsPromises.writeFile(absPath, contents);
  return absPath;
};

const runStatsScenario = async (name, {
  files,
  chunks,
  expect,
  fileRelations = null,
  expectBundleSizing = false
}) => {
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
    fileRelations
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
  if (expectBundleSizing) {
    if (!stats?.bundleSizing || typeof stats.bundleSizing !== 'object') {
      console.error(`Cross-file inference stats mismatch (${name}): missing bundleSizing.`);
      process.exit(1);
    }
    if (!Number.isFinite(stats.bundleSizing.p95BundleMs) || stats.bundleSizing.p95BundleMs < 0) {
      console.error(`Cross-file inference stats mismatch (${name}): invalid p95 bundle sizing metric.`);
      process.exit(1);
    }
    if (!Number.isFinite(stats.bundleSizing.p95HeapDeltaBytes) || stats.bundleSizing.p95HeapDeltaBytes < 0) {
      console.error(`Cross-file inference stats mismatch (${name}): invalid p95 heap delta metric.`);
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
      chunkUid: 'uid-zero',
      start: 0,
      end: zeroContent.length,
      docmeta: { returnsValue: false },
      codeRelations: {},
      metaV2: buildSymbolMeta({ file: 'src/zero.js', name: 'noop', kind: 'function', chunkUid: 'uid-zero' })
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
      chunkUid: 'uid-build',
      start: 0,
      end: oneConsumerContent.length,
      docmeta: {
        returnsValue: true,
        risk: { sources: [{ name: 'source', ruleId: 'rule-source', confidence: 0.8 }] }
      },
      codeRelations: {
        calls: [['buildWidget', 'makeWidget']],
        usages: ['Widget']
      },
      metaV2: buildSymbolMeta({ file: 'src/consumer.js', name: 'buildWidget', kind: 'function', chunkUid: 'uid-build' })
    },
    {
      file: 'src/creator.js',
      name: 'makeWidget',
      kind: 'function',
      chunkUid: 'uid-make',
      start: 0,
      end: creatorContent.length,
      docmeta: {
        returnType: 'Widget',
        returnsValue: false,
        risk: {
          sinks: [{ name: 'sink', ruleId: 'rule-sink', category: 'test', severity: 'high', tags: ['taint'] }]
        }
      },
      codeRelations: {},
      metaV2: buildSymbolMeta({ file: 'src/creator.js', name: 'makeWidget', kind: 'function', chunkUid: 'uid-make' })
    },
    {
      file: 'src/creator.js',
      name: 'Widget',
      kind: 'class',
      chunkUid: 'uid-widget',
      start: 0,
      end: creatorContent.length,
      docmeta: {},
      codeRelations: {},
      metaV2: buildSymbolMeta({ file: 'src/creator.js', name: 'Widget', kind: 'class', chunkUid: 'uid-widget' })
    }
  ],
  expect: {
    linkedCalls: 1,
    linkedUsages: 1,
    inferredReturns: 1,
    riskFlows: 1
  },
  expectBundleSizing: true
});

const perlCreateContent = [
  'sub create_widget {',
  "  return bless {}, 'Widget';",
  '}',
  ''
].join('\n');
const perlBuildContent = [
  'sub build_widget {',
  '  return create_widget();',
  '}',
  ''
].join('\n');
await runStatsScenario('perl-return-invocation', {
  files: {
    'lib/create_widget.pm': perlCreateContent,
    'lib/build_widget.pm': perlBuildContent
  },
  chunks: [
    {
      file: 'lib/build_widget.pm',
      name: 'build_widget',
      kind: 'FunctionDeclaration',
      chunkUid: 'uid-perl-build',
      start: 0,
      end: perlBuildContent.length,
      docmeta: { returnsValue: true },
      codeRelations: {
        calls: [['build_widget', 'create_widget']]
      },
      metaV2: buildSymbolMeta({
        file: 'lib/build_widget.pm',
        name: 'build_widget',
        kind: 'FunctionDeclaration',
        chunkUid: 'uid-perl-build'
      })
    },
    {
      file: 'lib/create_widget.pm',
      name: 'create_widget',
      kind: 'FunctionDeclaration',
      chunkUid: 'uid-perl-create',
      start: 0,
      end: perlCreateContent.length,
      docmeta: {
        returnType: 'Widget',
        returnsValue: true
      },
      codeRelations: {},
      metaV2: buildSymbolMeta({
        file: 'lib/create_widget.pm',
        name: 'create_widget',
        kind: 'FunctionDeclaration',
        chunkUid: 'uid-perl-create'
      })
    }
  ],
  expect: {
    linkedCalls: 1,
    linkedUsages: 0,
    inferredReturns: 1,
    riskFlows: 0
  }
});

const rubyCreateContent = [
  'def create_widget',
  "  return 'ok'",
  'end',
  ''
].join('\n');
const rubyBuildContent = [
  'def build_widget',
  '  return create_widget',
  'end',
  ''
].join('\n');
await runStatsScenario('ruby-return-invocation-without-parens', {
  files: {
    'lib/create_widget.rb': rubyCreateContent,
    'lib/build_widget.rb': rubyBuildContent
  },
  chunks: [
    {
      file: 'lib/build_widget.rb',
      name: 'build_widget',
      kind: 'FunctionDeclaration',
      chunkUid: 'uid-ruby-build',
      start: 0,
      end: rubyBuildContent.length,
      docmeta: { returnsValue: true },
      codeRelations: {
        calls: [['build_widget', 'create_widget']]
      },
      metaV2: buildSymbolMeta({
        file: 'lib/build_widget.rb',
        name: 'build_widget',
        kind: 'FunctionDeclaration',
        chunkUid: 'uid-ruby-build'
      })
    },
    {
      file: 'lib/create_widget.rb',
      name: 'create_widget',
      kind: 'FunctionDeclaration',
      chunkUid: 'uid-ruby-create',
      start: 0,
      end: rubyCreateContent.length,
      docmeta: {
        returnType: 'Widget',
        returnsValue: true
      },
      codeRelations: {},
      metaV2: buildSymbolMeta({
        file: 'lib/create_widget.rb',
        name: 'create_widget',
        kind: 'FunctionDeclaration',
        chunkUid: 'uid-ruby-create'
      })
    }
  ],
  expect: {
    linkedCalls: 1,
    linkedUsages: 0,
    inferredReturns: 1,
    riskFlows: 0
  }
});

const variableReturnProducer = [
  'export function status() {',
  "  return 'ok';",
  '}',
  ''
].join('\n');
const variableReturnConsumer = [
  'export function readStatus() {',
  "  const status = 'local';",
  '  return status;',
  '}',
  ''
].join('\n');
await runStatsScenario('return-variable-not-call', {
  files: {
    'src/status.js': variableReturnProducer,
    'src/consumer.js': variableReturnConsumer
  },
  chunks: [
    {
      file: 'src/consumer.js',
      name: 'readStatus',
      kind: 'function',
      chunkUid: 'uid-read-status',
      start: 0,
      end: variableReturnConsumer.length,
      docmeta: { returnsValue: true },
      codeRelations: {},
      metaV2: buildSymbolMeta({
        file: 'src/consumer.js',
        name: 'readStatus',
        kind: 'function',
        chunkUid: 'uid-read-status'
      })
    },
    {
      file: 'src/status.js',
      name: 'status',
      kind: 'function',
      chunkUid: 'uid-status',
      start: 0,
      end: variableReturnProducer.length,
      docmeta: {
        returnType: 'Widget',
        returnsValue: true
      },
      codeRelations: {},
      metaV2: buildSymbolMeta({
        file: 'src/status.js',
        name: 'status',
        kind: 'function',
        chunkUid: 'uid-status'
      })
    }
  ],
  expect: {
    linkedCalls: 0,
    linkedUsages: 0,
    inferredReturns: 0,
    riskFlows: 0
  }
});

const expressionReturnProducer = [
  'export function helper() {',
  "  return 'ok';",
  '}',
  ''
].join('\n');
const expressionReturnConsumer = [
  'export function computeStatus() {',
  "  const fallback = () => 'fallback';",
  '  return helper && fallback();',
  '}',
  ''
].join('\n');
await runStatsScenario('return-expression-not-bare-invocation', {
  files: {
    'src/helper.js': expressionReturnProducer,
    'src/consumer-expression.js': expressionReturnConsumer
  },
  chunks: [
    {
      file: 'src/consumer-expression.js',
      name: 'computeStatus',
      kind: 'function',
      chunkUid: 'uid-compute-status',
      start: 0,
      end: expressionReturnConsumer.length,
      docmeta: { returnsValue: true },
      codeRelations: {},
      metaV2: buildSymbolMeta({
        file: 'src/consumer-expression.js',
        name: 'computeStatus',
        kind: 'function',
        chunkUid: 'uid-compute-status'
      })
    },
    {
      file: 'src/helper.js',
      name: 'helper',
      kind: 'function',
      chunkUid: 'uid-helper-expression',
      start: 0,
      end: expressionReturnProducer.length,
      docmeta: {
        returnType: 'Widget',
        returnsValue: true
      },
      codeRelations: {},
      metaV2: buildSymbolMeta({
        file: 'src/helper.js',
        name: 'helper',
        kind: 'function',
        chunkUid: 'uid-helper-expression'
      })
    }
  ],
  expect: {
    linkedCalls: 0,
    linkedUsages: 0,
    inferredReturns: 0,
    riskFlows: 0
  }
});

const shellHelperContent = [
  'helper() {',
  "  echo 'ok'",
  '}',
  ''
].join('\n');
const shellWrapperContent = [
  'run_wrapper() {',
  '  helper',
  '  return 0',
  '}',
  ''
].join('\n');
await runStatsScenario('shell-status-return', {
  files: {
    'src/helper.sh': shellHelperContent,
    'src/wrapper.sh': shellWrapperContent
  },
  chunks: [
    {
      file: 'src/wrapper.sh',
      name: 'run_wrapper',
      kind: 'FunctionDeclaration',
      chunkUid: 'uid-shell-wrapper',
      start: 0,
      end: shellWrapperContent.length,
      docmeta: { returnsValue: true },
      codeRelations: {
        calls: [['run_wrapper', 'helper']]
      },
      metaV2: buildSymbolMeta({
        file: 'src/wrapper.sh',
        name: 'run_wrapper',
        kind: 'FunctionDeclaration',
        chunkUid: 'uid-shell-wrapper'
      })
    },
    {
      file: 'src/helper.sh',
      name: 'helper',
      kind: 'FunctionDeclaration',
      chunkUid: 'uid-shell-helper',
      start: 0,
      end: shellHelperContent.length,
      docmeta: {
        returnType: 'string',
        returnsValue: true
      },
      codeRelations: {},
      metaV2: buildSymbolMeta({
        file: 'src/helper.sh',
        name: 'helper',
        kind: 'FunctionDeclaration',
        chunkUid: 'uid-shell-helper'
      })
    }
  ],
  expect: {
    linkedCalls: 1,
    linkedUsages: 0,
    inferredReturns: 0,
    riskFlows: 0
  }
});

const fallbackUsageFile = [
  'def first',
  '  1',
  'end',
  '',
  'def second',
  '  2',
  'end',
  ''
].join('\n');
const fallbackTargetFile = [
  'class Widget',
  'end',
  ''
].join('\n');
await runStatsScenario('file-usage-fallback-applies-once', {
  files: {
    'lib/a.rb': fallbackUsageFile,
    'lib/widget.rb': fallbackTargetFile
  },
  chunks: [
    {
      file: 'lib/a.rb',
      name: 'first',
      kind: 'FunctionDeclaration',
      chunkUid: 'uid-a-first',
      start: 0,
      end: fallbackUsageFile.length,
      docmeta: { returnsValue: false },
      codeRelations: {},
      metaV2: buildSymbolMeta({
        file: 'lib/a.rb',
        name: 'first',
        kind: 'FunctionDeclaration',
        chunkUid: 'uid-a-first'
      })
    },
    {
      file: 'lib/a.rb',
      name: 'second',
      kind: 'FunctionDeclaration',
      chunkUid: 'uid-a-second',
      start: 0,
      end: fallbackUsageFile.length,
      docmeta: { returnsValue: false },
      codeRelations: {},
      metaV2: buildSymbolMeta({
        file: 'lib/a.rb',
        name: 'second',
        kind: 'FunctionDeclaration',
        chunkUid: 'uid-a-second'
      })
    },
    {
      file: 'lib/widget.rb',
      name: 'Widget',
      kind: 'class',
      chunkUid: 'uid-widget-fallback',
      start: 0,
      end: fallbackTargetFile.length,
      docmeta: {},
      codeRelations: {},
      metaV2: buildSymbolMeta({
        file: 'lib/widget.rb',
        name: 'Widget',
        kind: 'class',
        chunkUid: 'uid-widget-fallback'
      })
    }
  ],
  fileRelations: {
    'lib/a.rb': {
      usages: ['Widget']
    }
  },
  expect: {
    linkedCalls: 0,
    linkedUsages: 1,
    inferredReturns: 0,
    riskFlows: 0
  }
});

console.log('Cross-file inference stats ok.');

