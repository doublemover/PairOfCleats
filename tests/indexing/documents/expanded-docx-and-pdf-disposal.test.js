import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { extractZipEntry } from '../../../src/index/extractors/docx.js';
import { readPdfPages } from '../../../src/index/extractors/pdf.js';
const expanded = Buffer.alloc(8192, 65), payload = zlib.deflateRawSync(expanded);
const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50);
const zip = Buffer.concat([header, payload]);
const entry = { localHeaderOffset: 0, compressedSize: payload.length, uncompressedSize: 0, compressionMethod: 8 };
assert.throws(() => extractZipEntry(zip, entry, 512), error => error.code === 'ERR_BUFFER_TOO_LARGE');
assert.deepEqual(extractZipEntry(zip, entry, 8192), expanded);
let loadingDestroyed = 0, documentDestroyed = 0;
const policy = { maxPages: 2, extractTimeoutMs: 20 };
const throwing = { getDocument: () => ({ destroy: async () => { loadingDestroyed += 1; }, promise: Promise.resolve({
  numPages: 1, destroy: async () => { documentDestroyed += 1; }, getPage: async () => { throw new Error('page failure'); }
}) }) };
await assert.rejects(readPdfPages({ pdfjs: throwing, source: Buffer.from('pdf'), policy }), /page failure/);
assert.equal(loadingDestroyed, 1); assert.equal(documentDestroyed, 1);
let resolveLate;
const hanging = { getDocument: () => ({ destroy: async () => { loadingDestroyed += 1; },
  promise: new Promise(resolve => { resolveLate = resolve; }) }) };
await assert.rejects(readPdfPages({ pdfjs: hanging, source: Buffer.from('pdf'), policy }), { code: 'EXTRACT_TIMEOUT' });
assert.equal(loadingDestroyed, 2);
resolveLate({ numPages: 0, destroy: async () => { documentDestroyed += 1; } });
await new Promise(resolve => setImmediate(resolve));
assert.equal(documentDestroyed, 2, 'a document arriving after timeout is disposed before use');
console.log('expanded DOCX and PDF disposal passed');
