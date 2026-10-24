import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { withContainedFile, assertNoSymlinkPath } from './contained-file.js';
import { readExactAt } from './io/read-exact.js';
import { safeOnnxRelativePath } from './onnx-installation.js';
import { throwIfAborted } from './abort.js';

const MAX_FILE_BYTES = 64 * 1024 ** 3;
const MAX_FIELDS = 4_000_000;
// ONNX's declared message edges, including nested graphs, sparse tensors,
// function defaults and training graphs: https://github.com/onnx/onnx/blob/main/onnx/onnx.proto
const children = {
  model: { 7: 'graph', 20: 'training', 25: 'function' },
  graph: { 1: 'node', 5: 'tensor', 15: 'sparse' },
  node: { 5: 'attribute' },
  attribute: { 5: 'tensor', 6: 'graph', 10: 'tensor', 11: 'graph', 22: 'sparse', 23: 'sparse' },
  sparse: { 1: 'tensor', 2: 'tensor' },
  training: { 1: 'graph', 2: 'graph' },
  function: { 7: 'node', 11: 'attribute' }, tensor: { 13: 'entry' }, entry: {}
};
const invalid = message => Object.assign(new Error(message), { code: 'ERR_ONNX_ARTIFACT_CLOSURE' });
const sameStat = (left, right) => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => left[key] === right[key]);

/** Walk only protobuf metadata, skipping embedded raw tensors without loading
 * their bytes. One 64 KiB window, bounded strings, fields and message depth. */
export const readOnnxExternalData = async (graphPath, { signal = null } = {}) => {
  throwIfAborted(signal);
  const root = path.dirname(graphPath);
  return withContainedFile(root, graphPath, async handle => {
    const before = await handle.stat();
    if (!before.size || before.size > MAX_FILE_BYTES) throw invalid('ONNX graph exceeds the admitted file bound.');
    const window = Buffer.allocUnsafe(64 * 1024);
    let windowStart = -1, windowLength = 0, fields = 0, graphs = 0;
    const byteAt = async position => {
      if (position < windowStart || position >= windowStart + windowLength) {
        throwIfAborted(signal);
        windowStart = position;
        const read = await readExactAt(handle, window, 0, Math.min(window.length, before.size - position), position);
        windowLength = read.bytesRead;
      }
      if (position < 0 || position >= before.size || !windowLength) throw invalid('Truncated ONNX wire metadata.');
      return window[position - windowStart];
    };
    const varint = async (position, end) => {
      let value = 0n;
      for (let i = 0; i < 10 && position + i < end; i++) {
        const byte = await byteAt(position + i);
        if (i === 9 && byte > 1) throw invalid('ONNX varint overflow.');
        value |= BigInt(byte & 127) << BigInt(i * 7);
        if (!(byte & 128)) return { value, next: position + i + 1 };
      }
      throw invalid('Invalid ONNX varint.');
    };
    const references = [];
    const visit = async (kind, start, end, depth = 0) => {
      if (depth > 64) throw invalid('Nested ONNX metadata exceeds its depth bound.');
      const values = {}, external = {};
      let externalLocation = false;
      for (let cursor = start; cursor < end;) {
        if (++fields > MAX_FIELDS) throw invalid('ONNX metadata exceeds its field bound.');
        if (fields % 1024 === 0) throwIfAborted(signal);
        const tag = await varint(cursor, end);
        cursor = tag.next;
        const number = Number(tag.value >> 3n), wire = Number(tag.value & 7n);
        if (!number || number > 536870911) throw invalid('Invalid ONNX field.');
        if (wire === 0) {
          const integer = await varint(cursor, end); cursor = integer.next;
          if (kind === 'tensor' && number === 14) externalLocation = integer.value === 1n;
          continue;
        }
        if (wire === 1 || wire === 5) { cursor += wire === 1 ? 8 : 4; if (cursor > end) throw invalid('Truncated ONNX scalar.'); continue; }
        if (wire !== 2) throw invalid('Unsupported ONNX wire type.');
        const length = await varint(cursor, end); cursor = length.next;
        if (length.value > BigInt(end - cursor)) throw invalid('Truncated ONNX message.');
        const next = cursor + Number(length.value);
        const child = children[kind][number];
        if (kind === 'model' && number === 7) graphs++;
        if (child) {
          const entry = await visit(child, cursor, next, depth + 1);
          if (kind === 'tensor' && child === 'entry') {
            if (!entry[1] || Object.hasOwn(external, entry[1])) throw invalid('Duplicate or missing ONNX external-data key.');
            external[entry[1]] = entry[2];
          }
        } else if (kind === 'entry' && [1, 2].includes(number)) {
          if (next - cursor > 4096) throw invalid('ONNX external-data string exceeds its bound.');
          const bytes = Buffer.alloc(next - cursor);
          const read = await readExactAt(handle, bytes, 0, bytes.length, cursor);
          if (read.bytesRead !== bytes.length) throw invalid('Truncated ONNX external-data string.');
          if (Object.hasOwn(values, number)) throw invalid('Duplicate ONNX external-data entry field.');
          values[number] = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        }
        cursor = next;
      }
      if (kind === 'tensor' && (externalLocation || Object.keys(external).length)) {
        if (!externalLocation || !safeOnnxRelativePath(external.location)) throw invalid('Unsafe or incomplete ONNX external-data location.');
        for (const field of ['offset', 'length']) if (external[field] != null && !/^\d+$/u.test(external[field])) throw invalid('Invalid ONNX external-data byte range.');
        references.push(external);
        if (references.length > 100_000) throw invalid('ONNX external-data reference count exceeds its bound.');
      }
      return values;
    };
    await visit('model', 0, before.size);
    if (graphs !== 1 || !sameStat(before, await handle.stat())) throw invalid('ONNX graph is incomplete or changed during inspection.');
    throwIfAborted(signal);
    handle.verify();
    Object.defineProperty(references, 'sourceStat', { value: before });
    return references;
  });
};

export const fingerprintOnnxFile = async (root, file, { signal = null } = {}) => {
  throwIfAborted(signal);
  return withContainedFile(root, file, async handle => {
    const before = await handle.stat();
    if (before.size > MAX_FILE_BYTES) throw invalid('ONNX asset exceeds its file bound.');
    const hash = createHash('sha256'), sha1 = createHash('sha1'), buffer = Buffer.allocUnsafe(1024 * 1024);
    for (let offset = 0; offset < before.size;) {
      throwIfAborted(signal);
      const read = await readExactAt(handle, buffer, 0, Math.min(buffer.length, before.size - offset), offset);
      if (!read.bytesRead) throw invalid('Truncated ONNX asset during verification.');
      hash.update(buffer.subarray(0, read.bytesRead)); sha1.update(buffer.subarray(0, read.bytesRead)); offset += read.bytesRead;
    }
    if (!sameStat(before, await handle.stat())) throw invalid('ONNX asset changed during verification.');
    throwIfAborted(signal);
    handle.verify();
    return Object.defineProperty({ bytes: before.size, sha256: hash.digest('hex'), sha1: sha1.digest('hex') },
      'sourceStat', { value: before });
  });
};

/** Validate the whole selected set after its final file has been read. This is
 * an acquisition consistency check; it never authorizes digest reuse by stat.
 */
export const verifyOnnxArtifactSnapshot = async (observed, { signal = null } = {}) => {
  for (const { root, file, stat } of observed) {
    throwIfAborted(signal);
    assertNoSymlinkPath(root, file);
    if (!sameStat(stat, await fs.stat(file))) throw invalid('ONNX acquisition changed across its selected file set.');
  }
};

export const planOnnxArtifactClosure = async (graphPath, graphName = path.basename(graphPath), { signal = null } = {}) => {
  throwIfAborted(signal);
  if (!safeOnnxRelativePath(graphName) || graphName.includes('/')) throw invalid('Unsafe ONNX graph target name.');
  const references = await readOnnxExternalData(graphPath, { signal }), root = path.dirname(graphPath);
  const graphIdentity = await fingerprintOnnxFile(root, graphPath, { signal });
  if (!sameStat(references.sourceStat, graphIdentity.sourceStat)) throw invalid('ONNX graph changed between metadata and byte verification.');
  const observed = [{ root, file: graphPath, stat: graphIdentity.sourceStat }];
  const files = new Map([[graphName, { path: graphName, source: graphPath, ...graphIdentity }]]);
  for (const reference of references) {
    throwIfAborted(signal);
    const file = path.join(root, ...reference.location.split('/'));
    let row = files.get(reference.location);
    if (row && row.source !== file) throw invalid('ONNX graph target collides with an external-data location.');
    if (!row) {
      if (files.size >= 128) throw invalid('ONNX closure exceeds its file count bound.');
      const identity = await fingerprintOnnxFile(root, file, { signal });
      observed.push({ root, file, stat: identity.sourceStat });
      row = { path: reference.location, source: file, ...identity };
      files.set(reference.location, row);
    }
    const offset = BigInt(reference.offset || '0'), length = reference.length == null ? BigInt(row.bytes) - offset : BigInt(reference.length);
    if (offset > BigInt(row.bytes) || offset + length > BigInt(row.bytes)) throw invalid('ONNX external-data range exceeds its selected file.');
    if (reference.checksum && reference.checksum.toLowerCase() !== row.sha1) throw invalid('ONNX external-data checksum mismatch.');
  }
  const rows = [...files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (rows.reduce((sum, row) => sum + row.bytes, 0) > 128 * 1024 ** 3) throw invalid('ONNX closure exceeds its total byte bound.');
  await verifyOnnxArtifactSnapshot(observed, { signal });
  const identities = rows.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  return Object.defineProperty({ graph: graphName, files: rows, digest: createHash('sha256').update(JSON.stringify(identities)).digest('hex') },
    'observed', { value: observed });
};
