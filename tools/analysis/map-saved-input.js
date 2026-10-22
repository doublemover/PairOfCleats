import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { MAP_MODEL_VERSION } from '../../src/map/constants.js';
import { readMapCacheEnvelope } from '../../src/shared/generated-artifact.js';
import { sourceEntityKey } from '../../src/map/isometric/client/data/protocol.js';

export const MAP_SAVED_INPUT_BYTES = 32 * 1024 * 1024;
const assertJsonDepth = (text) => {
  let depth = 0, quoted = false, escaped = false;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') {
      if (++depth > 64) throw new Error('Saved map exceeds the supported JSON depth (64).');
    } else if (character === '}' || character === ']') depth--;
  }
};

export const parseSavedMap = (text) => {
  if (typeof text !== 'string') throw new Error('Saved map input must be UTF-8 text.');
  if (Buffer.byteLength(text, 'utf8') > MAP_SAVED_INPUT_BYTES) throw new Error('Saved map exceeds the 32 MiB admission budget. Export a smaller explicit scope.');
  let json = text;
  let inputType = 'map-model';
  if (/^\s*</.test(text)) {
    const payloads = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
      .filter(match => /\bid\s*=\s*["']map-data["']/i.test(match[1]) && /\btype\s*=\s*["']application\/json["']/i.test(match[1]));
    if (payloads.length !== 1) throw new Error('HTML input must contain one generated application/json map-data payload. Scripts are never imported.');
    json = payloads[0][2];
    inputType = 'generated-html-payload';
  }
  assertJsonDepth(json);
  let model = JSON.parse(json);
  if(model?.__poc_session_manifest?.version===1)throw new Error('This is a session manifest, not an offline map snapshot. Export report map --format json or save the pinned compatibility viewer payload.');
  if (model?.__poc_generated) {
    const cacheKey = model.__poc_generated.key;
    model = /^[a-f0-9]{64}$/.test(cacheKey || '') ? readMapCacheEnvelope(model, cacheKey) : null;
    if (!model) throw new Error('Unsupported or malformed generated map-cache envelope. Export a map model JSON instead.');
    inputType = 'generated-map-cache';
  }
  if (!model || !Array.isArray(model.nodes) || !Array.isArray(model.edges) || !model.root || typeof model.root !== 'object') {
    throw new Error('Input is not a map model. Report summaries, node lists and raw repo_map artifacts cannot be opened; export with report map --format json --out <model.json>.');
  }
  if (![MAP_MODEL_VERSION, '1.0.0'].includes(model.version)) throw new Error(`Unsupported map model version ${String(model.version)}; expected ${MAP_MODEL_VERSION} or legacy 1.0.0.`);
  const fileIds = new Set(), memberIds = new Set();
  let members = 0;
  for (const file of model.nodes) {
    const filePath = file?.path || file?.name;
    if (typeof filePath !== 'string' || !filePath || filePath.length > 16384 || fileIds.has(filePath)) throw new Error('Map files require unique bounded paths.');
    fileIds.add(filePath);
    if (file.members != null && !Array.isArray(file.members)) throw new Error(`Invalid members array for ${filePath}.`);
    for (const member of file.members || []) {
      if (!member || typeof member !== 'object') throw new Error(`Invalid member in ${filePath}.`);
      if (member.id != null) {
        if (!['string','number'].includes(typeof member.id) || (typeof member.id === 'number' && !Number.isFinite(member.id))) throw new Error('Map member IDs must be opaque strings or finite numbers.');
        const key = sourceEntityKey('member', member.id);
        if (memberIds.has(key)) throw new Error('Duplicate map member identity.');
        memberIds.add(key);
      }
      if (++members > 1000000) throw new Error('Saved map exceeds the member admission budget.');
    }
  }
  if (model.nodes.length > 250000 || model.edges.length > 1000000) throw new Error('Saved map exceeds the entity admission budget.');
  for (const edge of model.edges) {
    if (!edge || typeof edge !== 'object' || !edge.from || !edge.to) throw new Error('Map relationships require source and target endpoints.');
  }
  return { model, inputType, sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text),
    provenance: { kind: 'saved-snapshot', source: model.provenance || null, generatedAt: model.generatedAt || null,
      generationHealth: 'not-revalidated', legacy: model.version !== MAP_MODEL_VERSION } };
};

const sameSourceSnapshot = (left, right) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => left[key] === right[key]);

export const readSavedMap = async (inputPath, { signal = null, fsImpl = fs } = {}) => {
  signal?.throwIfAborted();
  const handle = await fsImpl.open(inputPath, 'r');
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(MAP_SAVED_INPUT_BYTES)) throw new Error('Saved map must be a regular file no larger than 32 MiB.');
    signal?.throwIfAborted();
    const chunks = [], rawHash = createHash('sha256'); let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, signal })) {
      signal?.throwIfAborted();
      bytes += chunk.length;
      if (bytes > MAP_SAVED_INPUT_BYTES) throw new Error('Saved map grew beyond its 32 MiB admission budget.');
      chunks.push(chunk); rawHash.update(chunk);
    }
    const after = await handle.stat({ bigint: true }), current = await fsImpl.stat(inputPath, { bigint: true });
    signal?.throwIfAborted();
    if (BigInt(bytes) !== before.size || !sameSourceSnapshot(before, after) || !sameSourceSnapshot(after, current)) {
      throw new Error('Saved map changed or was replaced during admission. Retry from a stable published snapshot.');
    }
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, bytes)); }
    catch { throw new Error('Saved map is not valid UTF-8; byte identity cannot be reconstructed through replacement characters.'); }
    const parsed = parseSavedMap(text);
    if (parsed.sha256 !== rawHash.digest('hex') || parsed.bytes !== bytes) throw new Error('Saved map decoding changed its original byte identity.');
    signal?.throwIfAborted();return parsed;
  } finally { await handle.close(); }
};
