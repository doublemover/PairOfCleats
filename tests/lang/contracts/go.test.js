#!/usr/bin/env node
import { ensureFixtureIndex, loadFixtureIndexMeta } from '../../helpers/fixture-index.js';

const { fixtureRoot, userConfig } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture'
});
const { chunkMeta, resolveChunkFile } = loadFixtureIndexMeta(fixtureRoot, userConfig);

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

console.log('Go contract checks ok.');
