// Core numeric instructions. Effects are operand/result counts, not runtime values.
export const WASM_OPS = new Map();
const add = (code, name, inputs, outputs, traps = false) => WASM_OPS.set(code, { name, inputs, outputs, traps });
for (const [code, name] of [[0, 'unreachable'], [1, 'nop'], [2, 'block'], [3, 'loop'], [4, 'if'], [5, 'else'], [11, 'end'], [12, 'br'], [13, 'br_if'], [14, 'br_table'], [15, 'return'], [16, 'call'], [17, 'call_indirect'], [26, 'drop'], [27, 'select'], [32, 'local.get'], [33, 'local.set'], [34, 'local.tee'], [35, 'global.get'], [36, 'global.set']]) add(code, name, 0, 0);
const loads = 'i32.load i64.load f32.load f64.load i32.load8_s i32.load8_u i32.load16_s i32.load16_u i64.load8_s i64.load8_u i64.load16_s i64.load16_u i64.load32_s i64.load32_u'.split(' ');
loads.forEach((name, i) => add(0x28 + i, name, 1, 1, true));
'i32.store i64.store f32.store f64.store i32.store8 i32.store16 i64.store8 i64.store16 i64.store32'.split(' ').forEach((name, i) => add(0x36 + i, name, 2, 0, true));
add(0x3f, 'memory.size', 0, 1); add(0x40, 'memory.grow', 1, 1);
['i32', 'i64', 'f32', 'f64'].forEach((type, i) => add(0x41 + i, type + '.const', 0, 1));
for (const [base, type] of [[0x45, 'i32'], [0x50, 'i64']]) {
  add(base, type + '.eqz', 1, 1);
  'eq ne lt_s lt_u gt_s gt_u le_s le_u ge_s ge_u'.split(' ').forEach((name, i) => add(base + 1 + i, type + '.' + name, 2, 1));
}
for (const [base, type] of [[0x5b, 'f32'], [0x61, 'f64']]) 'eq ne lt gt le ge'.split(' ').forEach((name, i) => add(base + i, type + '.' + name, 2, 1));
for (const [base, type] of [[0x67, 'i32'], [0x79, 'i64']]) {
  'clz ctz popcnt'.split(' ').forEach((name, i) => add(base + i, type + '.' + name, 1, 1));
  'add sub mul div_s div_u rem_s rem_u and or xor shl shr_s shr_u rotl rotr'.split(' ').forEach((name, i) => add(base + 3 + i, type + '.' + name, 2, 1, /^(div|rem)/.test(name)));
}
for (const [base, type] of [[0x8b, 'f32'], [0x99, 'f64']]) {
  'abs neg ceil floor trunc nearest sqrt'.split(' ').forEach((name, i) => add(base + i, type + '.' + name, 1, 1));
  'add sub mul div min max copysign'.split(' ').forEach((name, i) => add(base + 7 + i, type + '.' + name, 2, 1));
}
'i32.wrap_i64 i32.trunc_f32_s i32.trunc_f32_u i32.trunc_f64_s i32.trunc_f64_u i64.extend_i32_s i64.extend_i32_u i64.trunc_f32_s i64.trunc_f32_u i64.trunc_f64_s i64.trunc_f64_u f32.convert_i32_s f32.convert_i32_u f32.convert_i64_s f32.convert_i64_u f32.demote_f64 f64.convert_i32_s f64.convert_i32_u f64.convert_i64_s f64.convert_i64_u f64.promote_f32 i32.reinterpret_f32 i64.reinterpret_f64 f32.reinterpret_i32 f64.reinterpret_i64 i32.extend8_s i32.extend16_s i64.extend8_s i64.extend16_s i64.extend32_s'.split(' ').forEach((name, i) => add(0xa7 + i, name, 1, 1, name.includes('.trunc_')));

for (const [code,name,inputs,outputs] of [[0x12,'return_call',0,0],[0x13,'return_call_indirect',0,0],[0x14,'call_ref',0,0],[0x15,'return_call_ref',0,0],
  [0x25,'table.get',1,1],[0x26,'table.set',2,0],[0x1c,'select',3,1],[0xd0,'ref.null',0,1],[0xd1,'ref.is_null',1,1],[0xd2,'ref.func',0,1],[0xd3,'ref.eq',2,1],[0xd4,'ref.as_non_null',1,1],[0xd5,'br_on_null',1,1],[0xd6,'br_on_non_null',1,0],
  [6,'try',0,0],[7,'catch',0,0],[8,'throw',0,0],[9,'rethrow',0,0],[10,'throw_ref',1,0],[0x18,'delegate',0,0],[0x19,'catch_all',0,0],[0x1f,'try_table',0,0]]) add(code,name,inputs,outputs,code===0xd4);
