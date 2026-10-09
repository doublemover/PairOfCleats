import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const GRAPH_LIMIT_BYTES = 64 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const text = bytes => bytes.toString('utf8');
const MAX_FIELDS = 1000000;
const MAX_NODES = 100000;

function readVarint(bytes, start) {
  let value = 0n;
  for (let i = 0; i < 10; i++) {
    if (start + i >= bytes.length) throw new Error('Truncated protobuf varint.');
    const byte = bytes[start + i];
    if (i === 9 && byte > 1) throw new Error('Protobuf varint overflow.');
    value |= BigInt(byte & 127) << BigInt(i * 7);
    if (!(byte & 128)) return { value, end: start + i + 1 };
  }
  throw new Error('Invalid protobuf varint.');
}

/** Wire decoder retains original field bytes; no ONNX dependency or tensor loading. */
export function decodeFields(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > GRAPH_LIMIT_BYTES) throw new Error('Graph byte limit exceeded.');
  const fields = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    if (fields.length >= MAX_FIELDS) throw new Error('Protobuf field limit exceeded.');
    const start = cursor;
    const tag = readVarint(bytes, cursor); cursor = tag.end;
    const number = Number(tag.value >> 3n), wire = Number(tag.value & 7n);
    if (!number || number > 536870911) throw new Error('Invalid protobuf field number.');
    let value, payload;
    if (wire === 0) { const decoded = readVarint(bytes, cursor); value = decoded.value; cursor = decoded.end; }
    else if (wire === 1 || wire === 5) {
      const width = wire === 1 ? 8 : 4;
      payload = bytes.subarray(cursor, cursor + width); cursor += width;
    } else if (wire === 2) {
      const length = readVarint(bytes, cursor); cursor = length.end;
      if (length.value > BigInt(bytes.length - cursor)) throw new Error('Truncated protobuf payload.');
      payload = bytes.subarray(cursor, cursor + Number(length.value)); cursor += Number(length.value);
    } else throw new Error('Unsupported protobuf wire type.');
    if (cursor > bytes.length) throw new Error('Truncated protobuf fixed value.');
    fields.push({ number, wire, value, payload, raw: bytes.subarray(start, cursor) });
  }
  return fields;
}

function encodeVarint(value) {
  let remaining = BigInt(value);
  if (remaining < 0n) remaining = BigInt.asUintN(64, remaining);
  const bytes = [];
  do { bytes.push(Number(remaining & 127n) | (remaining > 127n ? 128 : 0)); remaining >>= 7n; } while (remaining);
  return Buffer.from(bytes);
}
export function encodeField(number, wire, value) {
  const tag = encodeVarint(BigInt(number) * 8n + BigInt(wire));
  if (wire === 0) return Buffer.concat([tag, encodeVarint(value)]);
  if (wire !== 2) throw new Error('Encoder accepts only varint or bytes.');
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([tag, encodeVarint(payload.length), payload]);
}
const first = (fields, number) => fields.find(field => field.number === number);
const stringField = (fields, number) => text(first(fields, number)?.payload ?? Buffer.alloc(0));
const integerField = (fields, number) => {
  const value = first(fields, number)?.value;
  if (value === undefined) return null;
  const signed = BigInt.asIntN(64, value);
  return signed <= BigInt(Number.MAX_SAFE_INTEGER) && signed >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(signed) : signed.toString();
};

function visitGraph(bytes, state, patch, depth = 0) {
  if (depth > 16) throw new Error('Nested ONNX graph limit exceeded.');
  const output = [];
  for (const field of decodeFields(bytes)) {
    if (field.number === 1 && field.wire === 2) {
      if (++state.nodes > MAX_NODES) throw new Error('ONNX node limit exceeded.');
      const node = decodeFields(field.payload);
      const op = stringField(node, 4), domain = stringField(node, 7);
      const key = domain ? domain + '::' + op : op;
      state.operators[key] = (state.operators[key] ?? 0) + 1;
      const attrs = node.filter(f => f.number === 5 && f.wire === 2).map(f => decodeFields(f.payload));
      const attrsByName = Object.fromEntries(attrs.map(a => [stringField(a, 1), integerField(a, 3)]));
      const nbits = op === 'MatMulNBits' && domain === 'com.microsoft';
      if (nbits) {
        if (patch && ![4, 8].includes(attrsByName.bits)) throw new Error('Only W4/W8 MatMulNBits derivatives are supported.');
        state.nbits.push({ name: stringField(node, 3), bits: attrsByName.bits, blockSize: attrsByName.block_size,
          accuracyLevel: attrsByName.accuracy_level ?? null, defaultAccuracyLevel: attrsByName.accuracy_level ?? 0 });
      }
      const rebuilt = [];
      for (const part of node) {
        if (part.number !== 5 || part.wire !== 2) { rebuilt.push(part.raw); continue; }
        const attribute = decodeFields(part.payload);
        if (patch && nbits && stringField(attribute, 1) === 'accuracy_level') continue;
        const attrParts = attribute.map(a => {
          if ((a.number === 6 || a.number === 11) && a.wire === 2) return encodeField(a.number, 2, visitGraph(a.payload, state, patch, depth + 1));
          if ((a.number === 5 || a.number === 10) && a.wire === 2) collectTensor(a.payload, state);
          return a.raw;
        });
        rebuilt.push(encodeField(5, 2, Buffer.concat(attrParts)));
      }
      if (patch && nbits) {
        const attribute = Buffer.concat([encodeField(1, 2, 'accuracy_level'), encodeField(3, 0, 4), encodeField(20, 0, 2)]);
        rebuilt.push(encodeField(5, 2, attribute)); state.patchedNodes++;
      }
      output.push(encodeField(1, 2, Buffer.concat(rebuilt)));
    } else {
      if (field.number === 5 && field.wire === 2) collectTensor(field.payload, state);
      if (field.number === 15 && field.wire === 2) {
        for (const tensor of decodeFields(field.payload)) if ([1, 2].includes(tensor.number) && tensor.wire === 2) collectTensor(tensor.payload, state);
      }
      output.push(field.raw);
    }
  }
  return Buffer.concat(output);
}

function collectTensor(bytes, state) {
  const fields = decodeFields(bytes);
  const entries = fields.filter(f => f.number === 13 && f.wire === 2).map(f => decodeFields(f.payload));
  if (!entries.length) return;
  const external = Object.fromEntries(entries.map(entry => [stringField(entry, 1), stringField(entry, 2)]));
  state.externalData.push({ tensor: stringField(fields, 8), ...external });
}

export function inspectOnnx(bytes, { patchAccuracyLevel = false } = {}) {
  const state = { nodes: 0, operators: {}, nbits: [], externalData: [], patchedNodes: 0 };
  const model = decodeFields(bytes), graphs = model.filter(field => field.number === 7 && field.wire === 2);
  if (graphs.length !== 1) throw new Error('Expected exactly one ONNX model graph.');
  const output = Buffer.concat(model.map(field => field.number === 7 && field.wire === 2
    ? encodeField(7, 2, visitGraph(field.payload, state, patchAccuracyLevel)) : field.raw));
  if (patchAccuracyLevel && !state.patchedNodes) throw new Error('No eligible MatMulNBits nodes.');
  return { report: { schema: 'eg2.onnx-inspection.v1', sha256: hash(bytes), bytes: bytes.length, ...state,
    dispatchEvidence: 'Graph attributes describe a requested recipe, not observed kernel dispatch.' }, bytes: output };
}

export async function readBounded(file, maxBytes = GRAPH_LIMIT_BYTES) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error('Input byte limit exceeded.');
  return fs.readFile(file);
}
export async function hashFile(file) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}
export async function withinTrialRoot(file, root) {
  const canonicalRoot = await fs.realpath(root), resolved = path.resolve(file);
  const parent = await fs.realpath(path.dirname(resolved));
  const relative = path.relative(canonicalRoot, path.join(parent, path.basename(resolved)));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Artifact must be inside the separate trial root.');
  try {
    const existing = await fs.realpath(resolved);
    if (existing !== path.join(parent, path.basename(resolved))) throw new Error('Symlink artifact rejected.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return path.join(parent, path.basename(resolved));
}

/** The derivative shares immutable external weights in a dedicated trial cache. */
export async function writeNbitsDerivative({ source, destination, trialRoot, expectedSha256, expectedExternalData }) {
  source = await withinTrialRoot(source, trialRoot); destination = await withinTrialRoot(destination, trialRoot);
  if (source === destination || path.dirname(source) !== path.dirname(destination)) throw new Error('Derivative requires a new filename beside source in trial cache.');
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 ?? '')) throw new Error('Pinned source SHA256 required.');
  if (!Array.isArray(expectedExternalData)) throw new Error('Verified external-data receipt required.');
  const bytes = await readBounded(source), result = inspectOnnx(bytes, { patchAccuracyLevel: true });
  if (result.report.sha256 !== expectedSha256) throw new Error('Source graph hash mismatch.');
  const externalData = [];
  for (const location of new Set(result.report.externalData.map(entry => entry.location))) {
    if (!location || path.isAbsolute(location) || location.includes('\\') || location.split('/').includes('..')) throw new Error('Unsafe ONNX external-data location.');
    const file = await withinTrialRoot(path.join(path.dirname(source), location), trialRoot);
    const stat = await fs.stat(file), sha256 = await hashFile(file);
    const expected = expectedExternalData.find(entry => entry.location === location);
    if (!expected || expected.sha256 !== sha256 || expected.bytes !== stat.size) throw new Error('External weights missing verified size/hash.');
    externalData.push({ location, bytes: stat.size, sha256 });
  }
  if (expectedExternalData.length !== externalData.length) throw new Error('External-data receipt must match graph locations exactly.');
  const derivative = inspectOnnx(result.bytes).report;
  if (JSON.stringify(result.report.externalData) !== JSON.stringify(derivative.externalData)) throw new Error('External-data references changed.');
  await fs.writeFile(destination, result.bytes, { flag: 'wx' });
  return { schema: 'eg2.nbits-derivative.v1', source, destination, sourceSha256: result.report.sha256,
    derivativeSha256: derivative.sha256, patchedNodes: result.report.patchedNodes, accuracyLevel: 4, externalData,
    semantics: 'New numerical recipe; separate trial vectors only. No measured W8A8/W4A8 dispatch or quality claim.' };
}
