#!/usr/bin/env node
import { applyCrossFileInference } from '../../../src/index/type-inference-crossfile.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const buildSymbol = (qualifiedName, chunkUid) => ({
  scheme: 'poc',
  qualifiedName,
  symbolKey: `sym:${qualifiedName}`,
  scopedId: null,
  symbolId: `sym:${chunkUid}`,
  kindGroup: 'function',
  chunkUid
});

const caller = {
  name: 'run',
  file: 'src/app.js',
  kind: 'function',
  chunkUid: 'uid-run',
  metaV2: { chunkUid: 'uid-run', symbol: buildSymbol('run', 'uid-run') },
  codeRelations: { calls: [['run', 'Local']] }
};

const callee = {
  name: 'target',
  file: 'src/lib.js',
  kind: 'function',
  chunkUid: 'uid-target',
  metaV2: { chunkUid: 'uid-target', symbol: buildSymbol('target', 'uid-target') },
  codeRelations: {}
};

const fileRelations = new Map([
  ['src/app.js', { importBindings: { Local: { imported: 'target', module: './lib' } } }]
]);

await applyCrossFileInference({
  rootDir: process.cwd(),
  buildRoot: process.cwd(),
  chunks: [caller, callee],
  enabled: true,
  log: () => {},
  useTooling: false,
  enableTypeInference: false,
  enableRiskCorrelation: false,
  fileRelations
});

const link = caller.codeRelations.callLinks?.[0];
if (!link) {
  fail('Expected a callLinks entry.');
}
if (link.to?.status !== 'resolved') {
  fail('Expected callLinks SymbolRef to resolve.');
}
if (link.to?.importHint?.resolvedFile !== 'src/lib.js') {
  fail('Expected import hint to resolve relative module path.');
}
if (link.fromChunkUid !== 'uid-run') {
  fail('Expected fromChunkUid to match uid-run.');
}
if (link.to?.resolved?.chunkUid !== 'uid-target') {
  fail('Expected resolved targetChunkUid to match uid-target.');
}
if (link.legacy?.file !== 'src/lib.js' || link.legacy?.target !== 'target') {
  fail('Expected resolved diagnostics fields to include file and target name.');
}

console.log('import-resolver-relative integration test passed');
