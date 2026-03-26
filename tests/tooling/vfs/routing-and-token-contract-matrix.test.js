#!/usr/bin/env node
import assert from 'node:assert/strict';
import { checksumString } from '../../../src/shared/hash.js';
import * as hashRouting from '../../../src/index/tooling/vfs-hash-routing.js';
import {
  buildToolingVirtualDocuments,
  buildVfsHashVirtualPath,
  buildVfsVirtualPath,
  resolveVfsVirtualPath
} from '../../../src/index/tooling/vfs.js';
import {
  buildVfsToken,
  buildVfsTokenUri,
  parseVfsTokenUri
} from '../../../src/integrations/tooling/lsp/uris.js';

const buildVfsRoutingToken = hashRouting.buildVfsRoutingToken || hashRouting.resolveVfsRoutingToken;

assert.equal(typeof buildVfsRoutingToken, 'function', 'Expected buildVfsRoutingToken export.');
assert.equal(hashRouting.VFS_HASH_ROUTING_SCHEMA_VERSION, '1.0.0');

{
  const virtualPath = '.poc-vfs/src/app.ts#seg:segu:v1:abc.ts';
  const docHash = 'xxh64:0123456789abcdef';
  const expectedHash = await checksumString(`${docHash}|${virtualPath}`);
  const token = await buildVfsRoutingToken({
    virtualPath,
    docHash,
    mode: 'docHash+virtualPath'
  });

  assert.equal(token, expectedHash?.value || '');
  assert.ok(/^[0-9a-f]{16}$/.test(token));
}

{
  const containerPath = 'src/app.ts';
  const segmentUid = 'segu:v1:abc';
  const effectiveExt = '.ts';
  const legacy = buildVfsVirtualPath({ containerPath, segmentUid, effectiveExt });
  const fallback = resolveVfsVirtualPath({
    containerPath,
    segmentUid,
    effectiveExt,
    docHash: null,
    hashRouting: true
  });
  assert.equal(fallback, legacy);

  const docHash = 'xxh64:0123456789abcdef';
  const hashPath = buildVfsHashVirtualPath({ docHash, effectiveExt });
  assert.ok(hashPath?.startsWith('.poc-vfs/by-hash/'));

  const resolved = resolveVfsVirtualPath({
    containerPath,
    segmentUid,
    effectiveExt,
    docHash,
    hashRouting: true
  });
  assert.equal(resolved, hashPath);
}

{
  const fileText = 'console.log(1);\n';
  const chunks = [
    {
      file: 'src/App.vue',
      lang: 'typescript',
      ext: '.vue',
      containerLanguageId: 'vue',
      segment: {
        segmentUid: 'segu:v1:hash',
        segmentId: 'seg-hash',
        start: 0,
        end: fileText.length,
        languageId: 'typescript',
        ext: '.ts'
      },
      chunkUid: 'chunk:1',
      start: 0,
      end: fileText.length,
      fileHash: 'deadbeef'
    }
  ];
  const fileTextByPath = new Map([['src/App.vue', fileText]]);
  const { documents } = await buildToolingVirtualDocuments({
    chunks,
    fileTextByPath,
    hashRouting: true,
    strict: true
  });

  assert.equal(documents.length, 1);
  const doc = documents[0];
  const expectedHashPath = buildVfsHashVirtualPath({
    docHash: doc.docHash,
    effectiveExt: doc.effectiveExt
  });
  assert.equal(doc.virtualPath, expectedHashPath);
  assert.equal(doc.legacyVirtualPath, '.poc-vfs/src/App.vue#seg:segu:v1:hash.ts');

  const plain = await buildToolingVirtualDocuments({
    chunks,
    fileTextByPath,
    hashRouting: false,
    strict: true
  });
  assert.equal(plain.documents[0].legacyVirtualPath, null);
  assert.equal(plain.documents[0].virtualPath, '.poc-vfs/src/App.vue#seg:segu:v1:hash.ts');
}

{
  const virtualPath = '.poc-vfs/docs/hello%world#seg:segu:v1:abc.ts';
  const docHash = 'xxh64:0123456789abcdef';
  const token = await buildVfsToken({ virtualPath, docHash, mode: 'docHash+virtualPath' });
  const uri = buildVfsTokenUri({ virtualPath, token });

  assert.ok(/^[0-9a-f]{16}$/.test(token));
  assert.ok(uri.startsWith('poc-vfs:///'));
  assert.ok(uri.includes('token='));
  assert.ok(uri.includes('%23'));
  assert.ok(!uri.includes('#seg:'));

  const parsed = parseVfsTokenUri(uri);
  assert.equal(parsed?.virtualPath, virtualPath);
  assert.equal(parsed?.token, token);
}

console.log('vfs routing and token contract matrix test passed');
