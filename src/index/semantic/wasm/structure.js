import { canonicalSemanticJson } from '../identity.js';
import { WASM_LIMITS } from './decode.js';

const owned = new WeakMap();
const freeze = value => {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) continue;
    Object.freeze(item); for (const child of Object.values(item)) pending.push(child);
  }
  return value;
};

/** A decoded binary has its own syntax catalog. No stack state, CFG block or
 * derived value is allocated here. The owned module also fences signal effects. */
export const createWasmStructuralCatalog = original => {
  const module = JSON.parse(canonicalSemanticJson(original, { maxBytes: 4 * 1024 * 1024 }));
  const nodes = [], functions = [], storages = {}, globalInitializers = [], instructionsByFunction = {};
  const counts = { functions: 0, instructions: 0, storage: 0, structuralNodes: 0 };
  const node = (kind, data) => {
    // Every structural record is backed by admitted binary bytes. This is
    // separate from the unchanged, smaller optional flow-graph allowance.
    if (nodes.length >= WASM_LIMITS.bytes) throw Object.assign(new Error('WASM structural catalog budget.'), { code: 'ERR_WASM_STRUCTURE_BUDGET' });
    const id = nodes.length; nodes.push({ id, kind, ...data });
    counts[kind === 'function' ? 'functions' : kind === 'instruction' ? 'instructions' : 'storage']++;
    counts.structuralNodes++; return id;
  };
  const imports = module.imports.map((item, ordinal) => ({ item, ordinal }));
  const importedFunctions = imports.filter(({ item }) => item.kind === 0);
  for (const [index, { item: fn, ordinal }] of [...importedFunctions,
    ...module.functions.map((item, ordinal) => ({ item, ordinal }))].entries()) {
    const imported = index < importedFunctions.length;
    const ref = node('function', { index, typeIndex: fn.typeIndex, import: imported ? fn : null,
      byteRange: imported ? module.sourceRanges?.imports[ordinal] ?? null : module.sourceRanges?.functionBodies[ordinal] ?? null,
      byteRangeRole: imported ? 'import-entry' : 'function-body' });
    functions.push({ index, ref, type: module.types[fn.typeIndex] });
  }
  for (const [kind, number, field] of [['table', 1, 'tables'], ['memory', 2, 'memories'], ['global', 3, 'globals'], ['tag', 4, 'tags']]) {
    const imported = imports.filter(({ item }) => item.kind === number);
    const definitions = [...imported.map(({ item, ordinal }) => ({ type: item[kind] || item, byteRange: module.sourceRanges?.imports[ordinal] ?? null, byteRangeRole: 'import-entry' })),
      ...module[field].map((type, index) => ({ type, byteRange: module.sourceRanges?.[field][index] ?? null, byteRangeRole: kind + '-definition' }))];
    storages[kind] = definitions.map(({ type, byteRange, byteRangeRole }, index) => node('storage', { storageKind: kind, index, type, byteRange, byteRangeRole }));
  }
  for (const [kind, field] of [['data', 'data'], ['element', 'elements']]) {
    storages[kind] = module[field].map((type, index) => node('storage', { storageKind: kind + '-segment', index, type,
      byteRange: module.sourceRanges?.[field][index] ?? null, byteRangeRole: kind + '-segment' }));
  }
  module.globals.forEach((type, index) => globalInitializers.push(node('storage', { storageKind: 'global-initializer', index, type,
    byteRange: module.sourceRanges?.globals[index] ?? null, byteRangeRole: 'global-definition' })));
  const instructions = (items, owner, extra) => items.map(item => node('instruction', { ...item, owner, ...extra }));
  for (const fn of module.functions) instructionsByFunction[fn.index] = instructions(fn.instructions, functions[fn.index].ref, { functionIndex: fn.index });
  for (const [index, global] of module.globals.entries()) instructions(global.initializer, globalInitializers[index], { expressionRole: 'global-initializer' });
  for (const [kind, field] of [['table', 'tables'], ['data', 'data'], ['element', 'elements']]) {
    const imported = kind === 'table' ? module.imports.filter(item => item.kind === 1).length : 0;
    for (const [index, item] of module[field].entries()) {
      const owner = storages[kind][imported + index];
      if (item.initializer) instructions(item.initializer, owner, { expressionRole: kind + '-initializer' });
      if (item.offset) instructions(item.offset, owner, { expressionRole: kind + '-offset' });
      for (const expression of item.expressions || []) instructions(expression, owner, { expressionRole: kind + '-element' });
    }
  }
  const catalog = freeze({ schemaVersion: 1, kind: 'wasm-structural-catalog', byteHash: module.byteHash,
    nodes, functions, storages, globalInitializers, instructionsByFunction,
    counts });
  freeze(module); owned.set(catalog, { original, module });
  return catalog;
};

export const consumeWasmStructuralCatalog = (catalog, original) => {
  const captured = owned.get(catalog);
  if (!captured || captured.original !== original) throw new TypeError('WASM flow requires the exact owned decoded-module catalog.');
  return captured.module;
};
