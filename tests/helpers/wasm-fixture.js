// Small hand-encoded modules keep binary fixtures reviewable; no toolchain or index.
export const wasmU32 = input => {
  const bytes = []; let value = input;
  do { const byte = value & 127; value = Math.floor(value / 128); bytes.push(byte | (value ? 128 : 0)); } while (value);
  return bytes;
};
export const wasmVector = values => [...wasmU32(values.length), ...values.flat()];
export const wasmName = text => { const bytes = [...Buffer.from(text)]; return [...wasmU32(bytes.length), ...bytes]; };
export const wasmSection = (id, data) => [id, ...wasmU32(data.length), ...data];
export const wasmModule = ({ types = [{ params: [0x7f], results: [0x7f] }], imports = [], functions = [], exports = [], sections = [] } = {}) => {
  const parts=[wasmSection(1, wasmVector(types.map(type => type.encoding || [0x60, ...wasmVector(type.params), ...wasmVector(type.results)]))), ...sections];
  if(imports.length)parts.push(wasmSection(2,wasmVector(imports.map(item=>[...wasmName(item.module),...wasmName(item.name),item.kind||0,...(item.descriptor||wasmU32(item.typeIndex||0))]))));
  if(functions.length)parts.push(wasmSection(3,wasmVector(functions.map(fn=>wasmU32(fn.typeIndex||0)))));
  if(exports.length)parts.push(wasmSection(7,wasmVector(exports.map(item=>[...wasmName(item.name),item.kind||0,...wasmU32(item.index)]))));
  if(functions.length)parts.push(wasmSection(10,wasmVector(functions.map(fn=>{
    const body=[...wasmVector((fn.locals||[]).map(type=>[1,...(Array.isArray(type)?type:[type])])),...fn.code,11];return [...wasmU32(body.length),...body];
  }))));
  const order=[0,1,2,3,4,5,13,6,7,8,9,12,10,11];parts.sort((a,b)=>order.indexOf(a[0])-order.indexOf(b[0]));
  return Buffer.from([0,97,115,109,1,0,0,0,...parts.flat()]);
};
export const wasmHostFixture = () => wasmModule({
  imports: [{ module: 'env', name: 'chosen' }],
  functions: [{ code: [0x20, 0, 0x10, 0] }], exports: [{ name: 'run', index: 1 }]
});
