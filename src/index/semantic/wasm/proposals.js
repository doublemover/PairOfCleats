import { WASM_PROPOSAL_OPS } from './proposal-opcodes.js';
export const readMemoryArgument = reader => {
  const flags = reader.leb(), memoryIndex = flags & 64 ? reader.leb() : 0;
  const offset = reader.leb(64);
  return { align: flags & ~64, memoryIndex, memoryOffset: Number(offset) <= Number.MAX_SAFE_INTEGER ? Number(offset) : offset };
};
const gcNames = 'struct.new struct.new_default struct.get struct.get_s struct.get_u struct.set array.new array.new_default array.new_fixed array.new_data array.new_elem array.get array.get_s array.get_u array.set array.len array.fill array.copy array.init_data array.init_elem ref.test ref.test_null ref.cast ref.cast_null br_on_cast br_on_cast_fail any.convert_extern extern.convert_any ref.i31 i31.get_s i31.get_u'.split(' ');
export const readProposalInstruction = (reader, prefix) => {
  const code = reader.leb(), key = prefix * 65536 + code;
  const spec = WASM_PROPOSAL_OPS.get(key);
  if (prefix === 0xfb) {
    if (!gcNames[code]) reader.fail('wasm_gc_opcode_unsupported_' + code, true);
    const item = { opcode: key, prefix, subopcode: code, name: gcNames[code] };
    if (code <= 14 || code >= 16 && code <= 19) item.typeIndex = reader.leb();
    if ([2,3,4,5].includes(code)) item.fieldIndex = reader.leb();
    if (code === 8) item.length = reader.leb();
    if ([9,10,17,18,19].includes(code)) item.secondIndex = reader.leb();
    if (code >= 20 && code <= 23) item.heapType = reader.leb(33, true);
    if (code === 24 || code === 25) { item.flags = reader.byte(); item.index = reader.leb(); item.fromType = reader.leb(33,true); item.toType = reader.leb(33,true); }
    return item;
  }
  if (!spec) reader.fail('wasm_opcode_unsupported_' + prefix.toString(16) + '_' + code, true);
  const item = { opcode: key, prefix, subopcode: code, name: spec.name };
  if (prefix === 0xfc) {
    if ([8,12].includes(code)) { item.segmentIndex = reader.leb(); item.storageIndex = reader.leb(); }
    else if ([10,14].includes(code)) { item.storageIndex = reader.leb(); item.sourceIndex = reader.leb(); }
    else if (code >= 9 && code <= 17) item.storageIndex = reader.leb();
  } else if (prefix === 0xfd) {
    if (spec.width) Object.assign(item, readMemoryArgument(reader));
    if (code === 12 || code === 13) item.bits = Buffer.from(reader.take(16)).toString('hex');
    if (/lane/.test(spec.name)) item.lane = reader.byte();
  } else if (prefix === 0xfe) {
    if (code === 3) { if (reader.byte() !== 0) reader.fail('wasm_atomic_fence_flags'); }
    else Object.assign(item, readMemoryArgument(reader));
  }
  return item;
};
export const proposalEffect = (item, module) => {
  if (item.prefix !== 0xfb) {
    const spec = WASM_PROPOSAL_OPS.get(item.opcode);
    if (item.name === 'table.grow') return { ...spec, inputs: 2, outputs: 1 };
    if (item.name === 'table.size') return { ...spec, inputs: 0, outputs: 1 };
    if (item.name === 'table.fill') return { ...spec, inputs: 3, outputs: 0 };
    return spec;
  }
  const code = item.subopcode;
  const inputs = code === 0 ? module.types[item.typeIndex].fields.length : code === 1 ? 0 : code <= 4 ? 1 : code === 5 ? 2
    : code === 6 ? 2 : code === 7 ? 1 : code === 8 ? item.length : code <= 13 ? 2 : code === 14 ? 3 : code === 15 ? 1
      : code === 16 ? 4 : code === 17 ? 5 : code <= 19 ? 4 : 1;
  return { inputs, outputs: [5,14,16,17,18,19].includes(code) ? 0 : 1, traps: code <= 23 };
};
