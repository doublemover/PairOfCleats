// Small hand-encoded modules keep binary fixtures reviewable; no toolchain or index.
export const wasmU32 = input => {
  const bytes = []; let value = input;
  do { const byte = value & 127; value = Math.floor(value / 128); bytes.push(byte | (value ? 128 : 0)); } while (value);
  return bytes;
};
export const wasmVector = values => [...wasmU32(values.length), ...values.flat()];
export const wasmName = text => { const bytes = [...Buffer.from(text)]; return [...wasmU32(bytes.length), ...bytes]; };
export const wasmSection = (id, data) => [id, ...wasmU32(data.length), ...data];
export const wasmModule = ({ types = [{ params: [0x7f], results: [0x7f] }], imports = [], functions = [], exports = [], sections = [] } = {}) => Buffer.from([
  0, 97, 115, 109, 1, 0, 0, 0,
  ...wasmSection(1, wasmVector(types.map(type => [0x60, ...wasmVector(type.params), ...wasmVector(type.results)]))),
  ...(imports.length ? wasmSection(2, wasmVector(imports.map(item => [...wasmName(item.module), ...wasmName(item.name), 0, ...wasmU32(item.typeIndex || 0)]))) : []),
  ...(functions.length ? wasmSection(3, wasmVector(functions.map(fn => wasmU32(fn.typeIndex || 0)))) : []),
  ...sections.filter(section => section[0] < 7).flat(),
  ...(exports.length ? wasmSection(7, wasmVector(exports.map(item => [...wasmName(item.name), item.kind || 0, ...wasmU32(item.index)]))) : []),
  ...sections.filter(section => section[0] >= 7 && section[0] < 10).flat(),
  ...(functions.length ? wasmSection(10, wasmVector(functions.map(fn => {
    const body = [...wasmVector((fn.locals || []).map(type => [1, type])), ...fn.code, 11]; return [...wasmU32(body.length), ...body];
  }))) : []),
  ...sections.filter(section => section[0] > 10).flat()
]);
export const wasmHostFixture = () => wasmModule({
  imports: [{ module: 'env', name: 'chosen' }],
  functions: [{ code: [0x20, 0, 0x10, 0] }], exports: [{ name: 'run', index: 1 }]
});
