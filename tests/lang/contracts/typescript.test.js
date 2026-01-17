#!/usr/bin/env node
import { ensureFixtureIndex, loadFixtureIndexMeta } from '../../helpers/fixture-index.js';

const { fixtureRoot, userConfig } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture'
});
const { chunkMeta, resolveChunkFile } = loadFixtureIndexMeta(fixtureRoot, userConfig);

const tsClass = chunkMeta.find((chunk) =>
  resolveChunkFile(chunk) === 'src/typescript_advanced.ts'
  && chunk.kind === 'ClassDeclaration'
  && chunk.name === 'Widget'
);
if (!tsClass) {
  console.error('Missing TypeScript class chunk (Widget).');
  process.exit(1);
}
const extendsList = tsClass.docmeta?.extends || [];
if (!extendsList.some((name) => String(name).includes('BaseWidget'))) {
  console.error('TypeScript extends metadata missing BaseWidget.');
  process.exit(1);
}

const tsFunc = chunkMeta.find((chunk) =>
  resolveChunkFile(chunk) === 'src/typescript_advanced.ts'
  && chunk.kind === 'FunctionDeclaration'
  && String(chunk.name || '').includes('makeWidget')
);
if (!tsFunc) {
  console.error('Missing TypeScript function chunk (makeWidget).');
  process.exit(1);
}
const controlFlow = tsFunc.docmeta?.controlFlow;
if (!controlFlow || !(controlFlow.returns >= 1)) {
  console.error('TypeScript controlFlow missing returns for makeWidget.');
  process.exit(1);
}

console.log('TypeScript contract checks ok.');
