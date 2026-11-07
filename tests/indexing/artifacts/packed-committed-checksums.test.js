import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {enqueueTokenPostingsArtifacts} from '../../../src/index/build/artifacts/token-postings.js';
import {createArtifactPieceRegistry} from '../../../src/index/build/artifacts/piece-registry.js';
import {makeTempDir} from '../../helpers/temp.js';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { createBaseIndex, defaultUserConfig } from '../validate/helpers.js';
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
const fixture = await createBaseIndex({ rootDir: path.join(root, 'validation') });
for (const piece of pieces) await fs.copyFile(path.join(root, piece.path), path.join(fixture.indexDir, piece.path));
fixture.manifest.pieces = fixture.manifest.pieces.filter(piece => piece.name !== 'token_postings').concat(pieces);
const manifestPath = path.join(fixture.indexDir, 'pieces', 'manifest.json');
await fs.writeFile(manifestPath, JSON.stringify(fixture.manifest));
const validate = () => validateIndexArtifacts({ root: fixture.repoRoot, indexRoot: fixture.indexRoot,
  modes: ['code'], userConfig: defaultUserConfig, strict: true, sqliteEnabled: false, lmdbEnabled: false });
const healthy = await validate(); assert.equal(healthy.ok, true, healthy.issues.join('\n'));
const metadata = path.join(fixture.indexDir, 'token_postings.packed.meta.json');
const originalMetadata = await fs.readFile(metadata, 'utf8');
const alteredMetadata = originalMetadata.replace(/("avgDocLen"\s*:\s*)2(?=\s*[,}])/u, (_match, prefix) => `${prefix}3`);
assert.notEqual(alteredMetadata, originalMetadata);
assert.equal(Buffer.byteLength(alteredMetadata), Buffer.byteLength(originalMetadata), 'numeric corruption preserves exact physical byte count');
await fs.writeFile(metadata, alteredMetadata);
const changed = await validate();
assert.equal(changed.ok, false);
assert.ok(changed.issues.some(issue => /checksum mismatch.*token_postings\.packed\.meta\.json/.test(issue)), changed.issues.join('\n'));
await fs.writeFile(metadata, originalMetadata);
const metaPiece = fixture.manifest.pieces.find(piece => piece.name === 'token_postings_meta');
for (const checksum of ['sha512:' + 'a'.repeat(128), 'sha256:bad', 'not-a-checksum']) {
  metaPiece.checksum = checksum; await fs.writeFile(manifestPath, JSON.stringify(fixture.manifest));
  const rejected = await validate(); assert.equal(rejected.ok, false);
  assert.ok(rejected.issues.some(issue => /checksum invalid|checksum.*unsupported/.test(issue)), rejected.issues.join('\n'));
}
await fs.rm(root, { recursive: true, force: true });
console.log('Packed/offset/metadata checksums match committed bytes without manifest rereads or registration reordering');
