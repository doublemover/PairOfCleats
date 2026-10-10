import { createHash } from 'node:crypto';
import { throwIfAborted } from '../../../shared/abort.js';
import { WASM_OPS } from './opcodes.js';

export const WASM_LIMITS = Object.freeze({ bytes: 65536, entries: 4096, instructions: 4096, locals: 256, depth: 128 });
const types = new Map([[0x7f, 'i32'], [0x7e, 'i64'], [0x7d, 'f32'], [0x7c, 'f64']]);
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
  type() { const value = types.get(this.byte()); if (!value) this.fail('wasm_value_type_unsupported', true); return value; }
  done() { if (this.pos !== this.end) this.fail('wasm_section_or_body_size_mismatch'); }
}
const limits = reader => {
  const flags = reader.leb(); if (flags > 1) reader.fail('wasm_shared_or_memory64_limits_unsupported', true);
  return { min: reader.leb(), max: flags ? reader.leb() : null };
};
const table = reader => { if (reader.byte() !== 0x70) reader.fail('wasm_table_type_unsupported', true); return { type: 'funcref', ...limits(reader) }; };
const globalType = reader => ({ type: reader.type(), mutable: reader.byte() });
const blockType = reader => {
  const first = reader.bytes[reader.pos];
  if (first === 0x40) { reader.byte(); return { params: [], results: [] }; }
  if (types.has(first)) return { params: [], results: [reader.type()] };
  const index = reader.leb(33, true); if (index < 0) reader.fail('wasm_block_type_unsupported', true); return { typeIndex: index };
};
const instruction = reader => {
  const offset = reader.pos, opcode = reader.byte(), spec = WASM_OPS.get(opcode);
  if (!spec) reader.fail('wasm_opcode_unsupported_' + opcode.toString(16), true);
  const item = { offset, opcode, name: spec.name };
  if ([2, 3, 4].includes(opcode)) item.type = blockType(reader);
  else if ([12, 13, 16, 32, 33, 34, 35, 36].includes(opcode)) item.index = reader.leb();
  else if (opcode === 14) { item.labels = reader.vector(r => r.leb()); item.fallback = reader.leb(); }
  else if (opcode === 17) { item.typeIndex = reader.leb(); item.tableIndex = reader.leb(); }
  else if (opcode >= 0x28 && opcode <= 0x3e) { item.align = reader.leb(); item.memoryOffset = reader.leb(); }
  else if (opcode === 0x3f || opcode === 0x40) item.memoryIndex = reader.leb();
  else if (opcode === 0x41 || opcode === 0x42) item.value = reader.leb(opcode === 0x41 ? 32 : 64, true);
  else if (opcode === 0x43 || opcode === 0x44) item.bits = Buffer.from(reader.take(opcode === 0x43 ? 4 : 8)).toString('hex');
  item.end = reader.pos; return item;
};
const expression = (reader, budget, signal) => {
  const result = [], stack = [];
  while (reader.pos < reader.end) {
    throwIfAborted(signal);
    if (++budget.instructions > WASM_LIMITS.instructions) reader.fail('wasm_instruction_budget', true);
    const item = instruction(reader), index = result.length; result.push(item);
    if ([2, 3, 4].includes(item.opcode)) {
      if (stack.length >= WASM_LIMITS.depth) reader.fail('wasm_control_depth_budget', true);
      stack.push(index);
    } else if (item.opcode === 5) {
      const parent = result[stack.at(-1)];
      if (!parent || parent.opcode !== 4 || parent.elseIndex != null) reader.fail('wasm_unmatched_else');
      parent.elseIndex = index;
    } else if (item.opcode === 11) {
      if (!stack.length) return result;
      const parent = result[stack.pop()]; parent.endIndex = index;
    }
  }
  reader.fail('wasm_missing_end');
};

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
    types: [], imports: [], functions: [], tables: [], memories: [], globals: [], exports: [], elements: [], data: [], start: null, customSections: [] };
  try {
    if (!reader.take(8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) reader.fail('wasm_magic_or_version_invalid');
    let previous = 0, code = null;
    while (reader.pos < reader.end) {
      throwIfAborted(signal);
      const id = reader.byte(), section = reader.sub(reader.leb());
      if (id > 11) section.fail('wasm_section_unsupported_' + id, true);
      if (id && id <= previous) section.fail('wasm_section_order_or_duplicate');
      if (id) previous = id;
      switch (id) {
        case 0: module.customSections.push({ name: section.name(), offset: section.pos, bytes: section.end - section.pos }); section.take(section.end - section.pos); break;
        case 1: module.types = section.vector(r => { if (r.byte() !== 0x60) r.fail('wasm_type_definition_unsupported', true); return { params: r.vector(r => r.type()), results: r.vector(r => r.type()) }; }); break;
        case 2: module.imports = section.vector(r => {
          const item = { module: r.name(), name: r.name(), kind: r.byte() };
          if (item.kind === 0) item.typeIndex = r.leb();
          else if (item.kind === 1) item.table = table(r);
          else if (item.kind === 2) item.memory = limits(r);
          else if (item.kind === 3) item.global = globalType(r);
          else r.fail('wasm_import_kind_unsupported', true);
          return item;
        }); break;
        case 3: module.functions = section.vector(r => ({ typeIndex: r.leb() })); break;
        case 4: module.tables = section.vector(table); break;
        case 5: module.memories = section.vector(limits); break;
        case 6: module.globals = section.vector(r => ({ ...globalType(r), initializer: expression(r, budget, signal) })); break;
        case 7: module.exports = section.vector(r => ({ name: r.name(), kind: r.byte(), index: r.leb() })); break;
        case 8: module.start = section.leb(); break;
        case 9: module.elements = section.vector(r => { if (r.leb() !== 0) r.fail('wasm_element_segment_mode_unsupported', true); return { offset: expression(r, budget, signal), functions: r.vector(r => r.leb()) }; }); break;
        case 10: code = section.vector(r => {
          const body = r.sub(r.leb()), locals = [];
          for (const group of body.vector(r => ({ count: r.leb(), type: r.type() }))) {
            if (locals.length + group.count > WASM_LIMITS.locals) body.fail('wasm_local_budget', true);
            for (let i = 0; i < group.count; i++) locals.push(group.type);
          }
          const instructions = expression(body, budget, signal); body.done(); return { locals, instructions };
        }); break;
        case 11: module.data = section.vector(r => { if (r.leb() !== 0) r.fail('wasm_data_segment_mode_unsupported', true); const offset = expression(r, budget, signal), data = r.take(r.leb()); return { offset, bytes: data.toString('hex') }; }); break;
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
