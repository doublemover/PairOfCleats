import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fail = message => Object.assign(new Error(message), { code: 'ERR_SEMANTICDB_EVIDENCE' });

// Application-owned projection of the public SemanticDB4 wire contract. Types,
// signatures and unsupported trees stay opaque in the retained original bytes.
// This is not a replacement copy of the upstream compiler data model.
const fields = {
  bundle: { 1: ['documents', 'document', true] },
  document: { 1: ['schema', 'int'], 2: ['uri', 'text'], 3: ['text', 'text'], 5: ['symbols', 'symbol', true],
    6: ['occurrences', 'occurrence', true], 7: ['diagnostics', 'diagnostic', true], 10: ['language', 'int'],
    11: ['md5', 'text'], 12: ['synthetics', 'synthetic', true], 13: ['buildTarget', 'text'] },
  range: { 1: ['startLine', 'int'], 2: ['startCharacter', 'int'], 3: ['endLine', 'int'], 4: ['endCharacter', 'int'] },
  occurrence: { 1: ['range', 'range'], 2: ['symbol', 'text'], 3: ['role', 'int'] },
  symbol: { 1: ['symbol', 'text'], 3: ['kind', 'int'], 4: ['properties', 'int'], 5: ['displayName', 'text'],
    16: ['language', 'int'], 17: ['signatureBase64', 'blob'], 19: ['overriddenSymbols', 'text', true] },
  diagnostic: { 1: ['range', 'range'], 2: ['severity', 'int'], 3: ['message', 'text'] },
  synthetic: { 1: ['range', 'range'], 2: ['tree', 'tree'] },
  tree: { 1: ['apply', 'apply'], 2: ['functionBase64', 'blob'], 3: ['id', 'id'], 4: ['literalBase64', 'blob'],
    5: ['macroExpansionBase64', 'blob'], 6: ['original', 'original'], 7: ['select', 'select'],
    8: ['typeApply', 'typeApply'], 9: ['assignBase64', 'blob'], 10: ['annotationBase64', 'blob'] },
  apply: { 1: ['function', 'tree'], 2: ['arguments', 'tree', true], 3: ['properties', 'int'] },
  id: { 1: ['symbol', 'text'] },
  original: { 1: ['range', 'range'] },
  select: { 1: ['qualifier', 'tree'], 2: ['id', 'id'] },
  typeApply: { 1: ['function', 'tree'], 2: ['typeArgumentsBase64', 'blob', true] }
};

export const decodeSemanticdbEvidenceWire = ({ bytes, check, maxNodes = 32768, maxDepth = 32 }) => {
  const version = require('protobufjs/package.json').version;
  if (version !== '8.8.0') throw fail('SemanticDB decoder version differs from the adapter profile.');
  const { Reader } = require('protobufjs/minimal');
  let nodes = 0, fieldCount = 0;
  const read = (input, kind, depth) => {
    check();
    if (++nodes > maxNodes || depth > maxDepth) throw fail('SemanticDB message/depth budget exhausted.');
    const reader = Reader.create(input), result = {}, known = fields[kind];
    while (reader.pos < reader.len) {
      check();
      if (++fieldCount > 65536) throw fail('SemanticDB wire field budget exhausted.');
      const tag = reader.uint32(), field = tag >>> 3, wire = tag & 7, spec = known[field];
      if (!field || ![0, 1, 2, 5].includes(wire)) throw fail('Unsupported SemanticDB wire field/group.');
      if (!spec) { reader.skipType(wire); (result.unknownFields ||= []).push(field); continue; }
      const [key, type, repeated] = spec;
      if (!repeated && Object.hasOwn(result, key)) throw fail('Duplicate singular SemanticDB wire field.');
      if (wire !== (type === 'int' ? 0 : 2)) throw fail('SemanticDB field wire type differs from its schema.');
      let value;
      if (type === 'int') {
        value = reader.uint32();
        if (value > 2147483647) throw fail('Negative/out-of-range SemanticDB scalar.');
      } else {
        const payload = reader.bytes();
        value = type === 'text' ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(payload)
          : type === 'blob' ? Buffer.from(payload).toString('base64') : read(payload, type, depth + 1);
      }
      if (repeated) {
        const entries = result[key] ||= [];
        if (entries.length >= (key === 'documents' ? 20 : 4096)) throw fail('SemanticDB repeated-field budget exhausted.');
        entries.push(value);
      } else result[key] = value;
    }
    if (reader.pos !== reader.len) throw fail('SemanticDB message boundary was not consumed exactly.');
    if (kind === 'tree' && Object.keys(result).filter(key => key !== 'unknownFields').length > 1) throw fail('Conflicting SemanticDB tree variants.');
    return result;
  };
  try { return { value: read(bytes, 'bundle', 0), runtimeVersion: version, nodes, fieldCount }; }
  catch (error) { if (error.code === 'ERR_SEMANTICDB_EVIDENCE' || error.name === 'AbortError') throw error;
    throw fail('Malformed SemanticDB binary artifact.'); }
};
