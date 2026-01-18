#!/usr/bin/env node
import { ensureFixtureIndex, loadFixtureIndexMeta } from '../../helpers/fixture-index.js';

const { fixtureRoot, userConfig } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture'
});
const { chunkMeta, resolveChunkFile } = loadFixtureIndexMeta(fixtureRoot, userConfig);

const jsWidgetClass = chunkMeta.find((chunk) => {
  if (!chunk || resolveChunkFile(chunk) !== 'src/javascript_advanced.js') return false;
  if (chunk.name !== 'Widget') return false;
  return chunk.kind === 'ClassDeclaration'
    || chunk.kind === 'ExportedClass'
    || chunk.kind === 'ExportDefaultClassDeclaration';
});
if (!jsWidgetClass) {
  console.error('Missing JS class chunk (Widget).');
  process.exit(1);
}
const bases = jsWidgetClass.docmeta?.extends || [];
if (!bases.includes('BaseWidget')) {
  console.error('JS class metadata missing BaseWidget extends.');
  process.exit(1);
}

const jsLoad = chunkMeta.find((chunk) =>
  resolveChunkFile(chunk) === 'src/javascript_advanced.js'
  && String(chunk.name || '').includes('Widget.load')
);
if (!jsLoad) {
  console.error('Missing JS async method chunk (Widget.load).');
  process.exit(1);
}
if (!jsLoad.docmeta?.modifiers?.async) {
  console.error('JS async modifier missing for Widget.load.');
  process.exit(1);
}

console.log('JavaScript contract checks ok.');
