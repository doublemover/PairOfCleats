#!/usr/bin/env node
import { ensureFixtureIndex, loadFixtureIndexMeta } from '../../helpers/fixture-index.js';

const { fixtureRoot, userConfig } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture',
  cacheScope: 'shared',
  requiredModes: ['code']
});
const { chunkMeta, fileMeta, resolveChunkFile } = loadFixtureIndexMeta(fixtureRoot, userConfig);

if (!Array.isArray(chunkMeta) || chunkMeta.length === 0) {
  console.error('Language fixture chunk_meta.json missing or empty.');
  process.exit(1);
}

const sampleChunk = chunkMeta.find((chunk) => chunk && (chunk.file || chunk.fileId));
const resolvedFile = sampleChunk ? resolveChunkFile(sampleChunk) : null;
if (!resolvedFile) {
  console.error('Language fixture chunk_meta entries missing file references.');
  process.exit(1);
}

if (fileMeta && !Array.isArray(fileMeta)) {
  console.error('Language fixture file_meta.json should be an array.');
  process.exit(1);
}

const goStruct = chunkMeta.find((chunk) =>
  resolveChunkFile(chunk) === 'src/go_advanced.go'
  && String(chunk.kind || '').includes('Struct')
  && String(chunk.name || '').includes('Widget')
);
if (!goStruct) {
  console.error('Missing Go struct chunk (Widget).');
  process.exit(1);
}
if (!String(goStruct.docmeta?.doc || '').includes('Widget holds a name')) {
  console.error('Go docstring missing for Widget struct.');
  process.exit(1);
}

const goFunc = chunkMeta.find((chunk) =>
  resolveChunkFile(chunk) === 'src/go_advanced.go'
  && String(chunk.kind || '').includes('Function')
  && String(chunk.name || '').includes('MakeWidget')
);
if (!goFunc) {
  console.error('Missing Go function chunk (MakeWidget).');
  process.exit(1);
}
const controlFlow = goFunc.docmeta?.controlFlow;
if (!controlFlow || !(controlFlow.returns >= 1)) {
  console.error('Go controlFlow missing returns for MakeWidget.');
  process.exit(1);
}

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

console.log('Language fixture contracts ok.');
