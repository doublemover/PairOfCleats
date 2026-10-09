import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {enqueueTokenPostingsArtifacts} from '../../../src/index/build/artifacts/token-postings.js';
import {createArtifactPieceRegistry} from '../../../src/index/build/artifacts/piece-registry.js';
import {makeTempDir} from '../../helpers/temp.js';
const root=await makeTempDir('packed-committed-checksums-');
const registry=createArtifactPieceRegistry({outDir:root,resolveArtifactTier:()=> 'hot'});
const tasks=[];
await enqueueTokenPostingsArtifacts({outDir:root,postings:{tokenVocab:['alpha'],tokenPostingsList:[[[0,2]]],avgDocLen:2},
  state:{docLengths:[2]},tokenPostingsFormat:'packed',enqueueWrite:(_label,fn)=>tasks.push(fn),...registry});
const before=registry.listPieceEntries().map(p=>p.layout.order);
for(const fn of tasks)await fn();
const pieces=registry.listPieceEntries();assert.deepEqual(pieces.map(p=>p.layout.order),before);
assert.equal(pieces.length,3);
for(const piece of pieces){const bytes=await fs.readFile(path.join(root,piece.path));assert.equal(piece.bytes,bytes.length);
  assert.equal(piece.checksum,'sha256:'+createHash('sha256').update(bytes).digest('hex'));}
console.log('Packed/offset/metadata checksums match committed bytes without manifest rereads or registration reordering');
