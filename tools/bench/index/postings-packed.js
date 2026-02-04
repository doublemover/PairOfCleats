#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import {
  packTfPostings,
  unpackTfPostings,
  encodePackedOffsets,
  decodePackedOffsets
} from '../../../src/shared/packed-postings.js';

const parseArgs = () => {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
};

const createRng = (seed) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const encodeVarint = (value, out) => {
  let v = value >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
};

const decodeVarint = (buffer, offset) => {
  let value = 0;
  let shift = 0;
  let pos = offset;
  for (;;) {
    const byte = buffer[pos];
    pos += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { value, offset: pos };
};

const encodeIdPostings = (postings) => {
  const offsets = new Array(postings.length + 1);
  const parts = [];
  let total = 0;
  for (let i = 0; i < postings.length; i += 1) {
    offsets[i] = total;
    const list = postings[i] || [];
    const bytes = [];
    encodeVarint(list.length, bytes);
    let prev = 0;
    for (const docId of list) {
      const delta = Math.max(0, docId - prev);
      encodeVarint(delta, bytes);
      prev = docId;
    }
    const buf = Buffer.from(bytes);
    parts.push(buf);
    total += buf.length;
  }
  offsets[postings.length] = total;
  return {
    buffer: Buffer.concat(parts, total),
    offsets
  };
};

const decodeIdPostings = (buffer, offsets, count) => {
  const lists = new Array(count);
  for (let i = 0; i < count; i += 1) {
    let cursor = offsets[i] || 0;
    const lenInfo = decodeVarint(buffer, cursor);
    const length = lenInfo.value;
    cursor = lenInfo.offset;
    const list = new Array(length);
    let prev = 0;
    for (let j = 0; j < length; j += 1) {
      const deltaInfo = decodeVarint(buffer, cursor);
      cursor = deltaInfo.offset;
      prev += deltaInfo.value;
      list[j] = prev;
    }
    lists[i] = list;
  }
  return lists;
};

const buildIdPostings = ({ vocabSize, docs, postingsPerToken, seed, label }) => {
  const rng = createRng(seed);
  const vocab = new Array(vocabSize);
  const postings = new Array(vocabSize);
  for (let i = 0; i < vocabSize; i += 1) {
    vocab[i] = `${label}-${i.toString(36)}`;
    const list = [];
    let cursor = Math.floor(rng() * docs);
    const count = Math.max(1, Math.floor(postingsPerToken * (0.6 + rng())));
    for (let j = 0; j < count; j += 1) {
      cursor += 1 + Math.floor(rng() * 12);
      if (cursor >= docs) break;
      list.push(cursor);
    }
    postings[i] = list;
  }
  return { vocab, postings };
};

const buildTfPostings = ({ vocabSize, docs, postingsPerToken, seed, label }) => {
  const rng = createRng(seed);
  const vocab = new Array(vocabSize);
  const postings = new Array(vocabSize);
  for (let i = 0; i < vocabSize; i += 1) {
    vocab[i] = `${label}-${i.toString(36)}`;
    const list = [];
    let cursor = Math.floor(rng() * docs);
    const count = Math.max(1, Math.floor(postingsPerToken * (0.6 + rng())));
    for (let j = 0; j < count; j += 1) {
      cursor += 1 + Math.floor(rng() * 12);
      if (cursor >= docs) break;
      const tf = 1 + Math.floor(rng() * 3);
      list.push([cursor, tf]);
    }
    postings[i] = list;
  }
  return { vocab, postings };
};

const runTimed = (fn, iterations) => {
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    fn();
  }
  return performance.now() - start;
};

const args = parseArgs();
const docs = Number(args.docs) || 100000;
const tokenVocab = Number(args.tokens) || 20000;
const phraseVocab = Number(args.phrases) || 6000;
const chargramVocab = Number(args.chargrams) || 12000;
const postingsPerToken = Number(args.postings) || 8;
const iterations = Number(args.iterations) || 8;
const seed = Number(args.seed) || 2024;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const workloads = [
  { label: 'token', vocabSize: tokenVocab, seedOffset: 1, type: 'tf' },
  { label: 'phrase', vocabSize: phraseVocab, seedOffset: 2, type: 'id' },
  { label: 'chargram', vocabSize: chargramVocab, seedOffset: 3, type: 'id' }
];

for (const workload of workloads) {
  const dataset = workload.type === 'tf'
    ? buildTfPostings({
      vocabSize: workload.vocabSize,
      docs,
      postingsPerToken,
      seed: seed + workload.seedOffset,
      label: workload.label
    })
    : buildIdPostings({
      vocabSize: workload.vocabSize,
      docs,
      postingsPerToken,
      seed: seed + workload.seedOffset,
      label: workload.label
    });

  const jsonPayload = JSON.stringify({ vocab: dataset.vocab, postings: dataset.postings });
  const jsonBytes = Buffer.byteLength(jsonPayload, 'utf8');
  const vocabBytes = Buffer.byteLength(JSON.stringify(dataset.vocab), 'utf8');

  let jsonMs = null;
  if (mode !== 'current') {
    runTimed(() => JSON.parse(jsonPayload), Math.max(1, Math.floor(iterations / 2)));
    jsonMs = runTimed(() => JSON.parse(jsonPayload), iterations);
  }

  let packedBytes = null;
  let packedMs = null;
  let decodePacked = null;

  if (mode !== 'baseline') {
    if (workload.type === 'tf') {
      const packed = packTfPostings(dataset.postings);
      const offsetsBuffer = encodePackedOffsets(packed.offsets);
      packedBytes = vocabBytes + packed.buffer.length + offsetsBuffer.length;
      decodePacked = () => {
        const offsets = decodePackedOffsets(offsetsBuffer);
        unpackTfPostings(packed.buffer, offsets, { blockSize: packed.blockSize });
      };
    } else {
      const packed = encodeIdPostings(dataset.postings);
      const offsetsBuffer = encodePackedOffsets(packed.offsets);
      packedBytes = vocabBytes + packed.buffer.length + offsetsBuffer.length;
      decodePacked = () => {
        const offsets = decodePackedOffsets(offsetsBuffer);
        decodeIdPostings(packed.buffer, offsets, dataset.postings.length);
      };
    }

    if (decodePacked) {
      runTimed(decodePacked, Math.max(1, Math.floor(iterations / 2)));
      packedMs = runTimed(decodePacked, iterations);
    }
  }

  const ratio = packedBytes && jsonBytes ? packedBytes / jsonBytes : null;
  const delta = (jsonMs != null && packedMs != null) ? (packedMs - jsonMs) : null;

  const parts = [
    `vocab=${workload.vocabSize}`,
    `docs=${docs}`,
    `jsonBytes=${jsonBytes}`
  ];
  if (packedBytes != null) parts.push(`packedBytes=${packedBytes}`);
  if (ratio != null) parts.push(`ratio=${ratio.toFixed(3)}`);
  if (jsonMs != null) parts.push(`jsonMs=${jsonMs.toFixed(1)}`);
  if (packedMs != null) parts.push(`packedMs=${packedMs.toFixed(1)}`);
  if (delta != null) parts.push(`delta=${delta.toFixed(1)}ms`);

  console.log(`[bench] ${workload.label} ${parts.join(' ')}`);
}
