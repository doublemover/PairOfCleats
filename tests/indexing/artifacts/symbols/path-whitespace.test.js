import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createSymbolArtifactChunks,runSymbolArtifactWriters } from './helpers/symbol-artifact-fixture.js';
import { createCallSites } from '../../../../src/index/build/artifacts/writers/call-sites.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';
const outDir=resolveTestCachePath(process.cwd(),`symbol-path-spaces-${crypto.randomUUID()}`);
try {
  await fs.mkdir(outDir,{recursive:true});
  const chunks=createSymbolArtifactChunks();const exact=' leading/two  spaces.js ';
  chunks[0].file=exact;chunks[0].metaV2.file=exact;chunks[0].metaV2.virtualPath=`${exact}#segment`;
  Object.assign(chunks[0].codeRelations.callDetails[0],{startLine:1,startCol:1,endLine:1,endCol:5});
  await runSymbolArtifactWriters({outDir,chunks});
  const read=name=>fs.readFile(path.join(outDir,`${name}.jsonl`),'utf8').then(text=>text.trim().split('\n').map(JSON.parse));
  assert.equal((await read('symbols')).find(row=>row.chunkUid==='uid-alpha').file,exact);
  assert.equal((await read('symbols')).find(row=>row.chunkUid==='uid-alpha').virtualPath,`${exact}#segment`);
  assert.equal((await read('symbol_edges'))[0].from.file,exact);
  assert.equal((await read('symbol_occurrences'))[0].host.file,exact);
  assert.equal(createCallSites({chunks})[0].file,exact);
} finally {await fs.rm(outDir,{recursive:true,force:true});}
console.log('symbol path whitespace preserved');
