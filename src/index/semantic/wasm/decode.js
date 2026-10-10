import { createHash } from 'node:crypto';
import { throwIfAborted } from '../../../shared/abort.js';
import { readProposalInstruction, readMemoryArgument } from './proposals.js';
import { WASM_OPS } from './opcodes.js';

export const WASM_LIMITS = Object.freeze({ bytes: 65536, entries: 4096, instructions: 4096, locals: 256, depth: 128 });
const types = new Map([[0x7f, 'i32'], [0x7e, 'i64'], [0x7d, 'f32'], [0x7c, 'f64'], [0x7b, 'v128'], [0x70, 'funcref'], [0x6f, 'externref']]);
class DecodeError extends Error {
  constructor(reason, offset, unsupported = false) { super(reason); this.reason = reason; this.offset = offset; this.unsupported = unsupported; }
}
class Reader {
  constructor(bytes, start = 0, end = bytes.length) { this.bytes = bytes; this.pos = start; this.end = end; }
  fail(reason, unsupported = false) { throw new DecodeError(reason, this.pos, unsupported); }
  byte() { if (this.pos >= this.end) this.fail('wasm_truncated_binary'); return this.bytes[this.pos++]; }
  take(count) { if (count > this.end - this.pos) this.fail('wasm_truncated_binary'); const start = this.pos; this.pos += count; return this.bytes.subarray(start, this.pos); }
  sub(count) { const start = this.pos; this.take(count); return new Reader(this.bytes, start, this.pos); }
  leb(bits = 32, signed = false) {
    let value = 0n, shift = 0n;
    for (let i = 0; i < Math.ceil(bits / 7); i++) {
      const byte = this.byte(); value |= BigInt(byte & 127) << shift; shift += 7n;
      if (!(byte & 128)) {
        if (signed && (byte & 64)) value -= 1n << shift;
        const min = signed ? -(1n << BigInt(bits - 1)) : 0n, max = (1n << BigInt(signed ? bits - 1 : bits)) - 1n;
        if (value < min || value > max) this.fail('wasm_leb_overflow');
        return bits === 64 ? value.toString() : Number(value);
      }
    }
    this.fail('wasm_leb_overflow');
  }
  vector(read) {
    const count = this.leb(); if (count > WASM_LIMITS.entries) this.fail('wasm_vector_budget', true);
    return Array.from({ length: count }, () => read(this));
  }
  name() { try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(this.take(this.leb())); } catch (error) { if (error instanceof DecodeError) throw error; this.fail('wasm_invalid_utf8_name'); } }
  type() { const code = this.byte();
    if (code === 0x63 || code === 0x64) return (code === 0x63 ? 'ref-null:' : 'ref:') + this.leb(33, true);
    if (code >= 0x69 && code <= 0x73) return 'ref-null:' + (code - 128);
    const value = types.get(code); if (!value) this.fail('wasm_value_type_unsupported', true); return value; }
  done() { if (this.pos !== this.end) this.fail('wasm_section_or_body_size_mismatch'); }
}
const limits = reader => {
  const flags = reader.leb(); if (flags > 7) reader.fail('wasm_limits_flags_unsupported', true);
  return { shared: Boolean(flags & 2), memory64: Boolean(flags & 4), min: reader.leb(flags & 4 ? 64 : 32), max: flags & 1 ? reader.leb(flags & 4 ? 64 : 32) : null };
};
const table = reader => ({ type: reader.type(), ...limits(reader) });
const globalType = reader => ({ type: reader.type(), mutable: reader.byte() });
const blockType = reader => {
  const first = reader.bytes[reader.pos];
  if (first === 0x40) { reader.byte(); return { params: [], results: [] }; }
  if (types.has(first) || first === 0x63 || first === 0x64 || first >= 0x69 && first <= 0x73) return { params: [], results: [reader.type()] };
  const index = reader.leb(33, true); if (index < 0) reader.fail('wasm_block_type_unsupported', true); return { typeIndex: index };
};
const instruction = reader => {
  const offset = reader.pos, opcode = reader.byte();
  if ([0xfb,0xfc,0xfd,0xfe].includes(opcode)) return { offset, ...readProposalInstruction(reader, opcode), end: reader.pos };
  const spec = WASM_OPS.get(opcode);
  if (!spec) reader.fail('wasm_opcode_unsupported_' + opcode.toString(16), true);
  const item = { offset, opcode, name: spec.name };
  if ([2,3,4,6,0x1f].includes(opcode)) item.type = blockType(reader);
  if (opcode === 0x1f) item.catches = reader.vector(r => { const kind=r.byte(); if(kind>3) r.fail('wasm_catch_kind'); return { kind, tag: kind<2?r.leb():null, label:r.leb() }; });
  else if ([7,8,9,12,13,16,18,20,21,24,32,33,34,35,36,37,38,0xd2,0xd5,0xd6].includes(opcode)) item.index = reader.leb();
  else if (opcode === 14) { item.labels = reader.vector(r => r.leb()); item.fallback = reader.leb(); }
  else if (opcode === 17 || opcode === 19) { item.typeIndex = reader.leb(); item.tableIndex = reader.leb(); }
  else if (opcode === 0x1c) item.types = reader.vector(r => r.type());
  else if (opcode >= 0x28 && opcode <= 0x3e) Object.assign(item,readMemoryArgument(reader));
  else if (opcode === 0x3f || opcode === 0x40) item.memoryIndex = reader.leb();
  else if (opcode === 0x41 || opcode === 0x42) item.value = reader.leb(opcode === 0x41 ? 32 : 64, true);
  else if (opcode === 0x43 || opcode === 0x44) item.bits = Buffer.from(reader.take(opcode === 0x43 ? 4 : 8)).toString('hex');
  else if (opcode === 0xd0) item.heapType = reader.leb(33,true);
  item.end = reader.pos; return item;
};
const expression = (reader, budget, signal) => {
  const result = [], stack = [];
  while (reader.pos < reader.end) {
    throwIfAborted(signal);
    if (++budget.instructions > WASM_LIMITS.instructions) reader.fail('wasm_instruction_budget', true);
    const item = instruction(reader), index = result.length; result.push(item);
    if ([2, 3, 4, 6, 0x1f].includes(item.opcode)) {
      if (stack.length >= WASM_LIMITS.depth) reader.fail('wasm_control_depth_budget', true);
      stack.push(index);
    } else if (item.opcode === 5) {
      const parent = result[stack.at(-1)];
      if (!parent || parent.opcode !== 4 || parent.elseIndex != null) reader.fail('wasm_unmatched_else');
      parent.elseIndex = index;
    } else if (item.opcode === 7 || item.opcode === 0x19) {
      const parent = result[stack.at(-1)]; if (!parent || parent.opcode !== 6) reader.fail('wasm_unmatched_catch');
      (parent.catchIndices ||= []).push(index);
    } else if (item.opcode === 24) {
      const parent = result[stack.pop()]; if (!parent || parent.opcode !== 6) reader.fail('wasm_unmatched_delegate'); parent.endIndex = index;
    } else if (item.opcode === 11) {
      if (!stack.length) return result;
      const parent = result[stack.pop()]; parent.endIndex = index;
    }
  }
  reader.fail('wasm_missing_end');
};

const definitionType = reader => {
  let code = reader.byte(), supertypes = [], final = true;
  if (code === 0x4f || code === 0x50) { final=code===0x4f; supertypes=reader.vector(r=>r.leb()); code=reader.byte(); }
  const field = r => ({ type: [0x78,0x77].includes(r.bytes[r.pos]) ? (r.byte()===0x78?'i8':'i16') : r.type(), mutable:r.byte() });
  if (code===0x60) return { params:reader.vector(r=>r.type()), results:reader.vector(r=>r.type()), supertypes, final };
  if (code===0x5f) return { kind:'struct', fields:reader.vector(field), supertypes, final };
  if (code===0x5e) return { kind:'array', field:field(reader), supertypes, final };
  reader.fail('wasm_type_definition_unsupported',true);
};
const sectionRank = new Map([1,2,3,4,5,13,6,7,8,9,12,10,11].map((id,index)=>[id,index+1]));
/** Decode bounded immutable module bytes without compiling, instantiating or executing.
 * The engine validator checks typing/index/section constraints after our supported
 * grammar is decoded. Its runtime version is part of the analysis identity.
 */
export const decodeWasmModule = (input, { signal = null } = {}) => {
  throwIfAborted(signal);
  if (!(input instanceof Uint8Array)) throw new TypeError('WASM input must be original bytes.');
  if (input.length > WASM_LIMITS.bytes) return { status: 'unsupported', reason: 'wasm_byte_budget', offset: 0 };
  const bytes = Buffer.from(input), reader = new Reader(bytes), budget = { instructions: 0 };
  const module = { byteHash: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length,
    types: [], imports: [], functions: [], tables: [], memories: [], globals: [], exports: [], elements: [], data: [], start: null, customSections: [], tags: [], dataCount: null };
  try {
    if (!reader.take(8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) reader.fail('wasm_magic_or_version_invalid');
    let previous = 0, code = null;
    while (reader.pos < reader.end) {
      throwIfAborted(signal);
      const id = reader.byte(), section = reader.sub(reader.leb());
      if (id && !sectionRank.has(id)) section.fail('wasm_section_unsupported_' + id, true);
      if (id && sectionRank.get(id) <= previous) section.fail('wasm_section_order_or_duplicate');
      if (id) previous = sectionRank.get(id);
      switch (id) {
        case 0: module.customSections.push({ name: section.name(), offset: section.pos, bytes: section.end - section.pos }); section.take(section.end - section.pos); break;
        case 1: module.types = section.vector(r => { if(r.bytes[r.pos]===0x4e) { r.byte(); return r.vector(definitionType); } return [definitionType(r)]; }).flat(); if(module.types.length>WASM_LIMITS.entries) section.fail('wasm_type_budget',true); break;
        case 2: module.imports = section.vector(r => {
          const item = { module: r.name(), name: r.name(), kind: r.byte() };
          if (item.kind === 0) item.typeIndex = r.leb();
          else if (item.kind === 1) item.table = table(r);
          else if (item.kind === 2) item.memory = limits(r);
          else if (item.kind === 3) item.global = globalType(r);
          else if (item.kind === 4) { if(r.byte()!==0) r.fail('wasm_tag_attribute'); item.typeIndex=r.leb(); }
          else r.fail('wasm_import_kind_unsupported', true);
          return item;
        }); break;
        case 3: module.functions = section.vector(r => ({ typeIndex: r.leb() })); break;
        case 4: module.tables = section.vector(r=> { if(r.bytes[r.pos]!==0x40)return table(r); r.byte(); if(r.byte()!==0)r.fail('wasm_table_init_flags'); return {...table(r),initializer:expression(r,budget,signal)}; }); break;
        case 5: module.memories = section.vector(limits); break;
        case 6: module.globals = section.vector(r => ({ ...globalType(r), initializer: expression(r, budget, signal) })); break;
        case 7: module.exports = section.vector(r => ({ name: r.name(), kind: r.byte(), index: r.leb() })); break;
        case 8: module.start = section.leb(); break;
        case 9: module.elements = section.vector(r => {
          const flags=r.leb(); if(flags>7)r.fail('wasm_element_segment_mode_unsupported',true);
          const mode=flags&1 ? flags&2?'declarative':'passive' : 'active';
          const tableIndex=flags===2||flags===6?r.leb():0;
          const offset=mode==='active'?expression(r,budget,signal):null;
          if(flags!==0 && flags<4 && r.byte()!==0)r.fail('wasm_element_kind');
          const type=flags>=5?r.type():'funcref';
          return {mode,tableIndex,offset,type,...(flags<4?{functions:r.vector(r=>r.leb())}:{expressions:r.vector(r=>expression(r,budget,signal))})};
        }); break;
        case 10: code = section.vector(r => {
          const body = r.sub(r.leb()), locals = [];
          for (const group of body.vector(r => ({ count: r.leb(), type: r.type() }))) {
            if (locals.length + group.count > WASM_LIMITS.locals) body.fail('wasm_local_budget', true);
            for (let i = 0; i < group.count; i++) locals.push(group.type);
          }
          const instructions = expression(body, budget, signal); body.done(); return { locals, instructions };
        }); break;
        case 11: module.data = section.vector(r => { const flags=r.leb(); if(flags>2)r.fail('wasm_data_segment_mode_unsupported',true); const memoryIndex=flags===2?r.leb():0;
          const offset=flags===1?null:expression(r,budget,signal), data=r.take(r.leb()); return {mode:flags===1?'passive':'active', memoryIndex, offset, bytes:data.toString('hex')}; }); break;
        case 12: module.dataCount=section.leb(); break;
        case 13: module.tags=section.vector(r=>{if(r.byte()!==0)r.fail('wasm_tag_attribute');return {typeIndex:r.leb()};}); break;
      }
      section.done();
    }
    if ((code?.length || 0) !== module.functions.length) reader.fail('wasm_function_code_count_mismatch');
    module.functions.forEach((fn, index) => Object.assign(fn, code[index]));
    if (!WebAssembly.validate(bytes)) reader.fail('wasm_validation_failed');
    const imported = module.imports.filter(item => item.kind === 0);
    module.functions.forEach((fn, index) => { fn.index = imported.length + index; });
    if ([...imported, ...module.functions].some(fn => module.types[fn.typeIndex].params.length + (fn.locals?.length || 0) > WASM_LIMITS.locals)) reader.fail('wasm_local_budget', true);
    return { status: 'decoded', module };
  } catch (error) {
    if (!(error instanceof DecodeError)) throw error;
    return { status: error.unsupported ? 'unsupported' : 'failed', reason: error.reason, offset: error.offset };
  }
};
