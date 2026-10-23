const snapshots = new WeakMap();
const fail = message => Object.assign(new TypeError(message), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
const variants = schema => schema.oneOf || schema.anyOf || [schema];
const shapesFor = (schema, type) => {
  const pending = [schema], shapes = [];
  while (pending.length) {
    const current = pending.pop();
    if (current.oneOf || current.anyOf) { pending.push(...variants(current)); continue; }
    if (current.type === type || Array.isArray(current.type) && current.type.includes(type)) shapes.push(current);
  }
  return shapes;
};
const arrayBound = shape => {
  if (Number.isSafeInteger(shape.maxItems)) return shape.maxItems;
  if (shape.uniqueItems === true && Array.isArray(shape.items?.enum)) return shape.items.enum.length;
  throw new TypeError('Semantic request array schema must declare a finite cardinality.');
};

/** Own request containers before validation or any external asynchronous call.
 * Field sets and cardinalities come from the existing authoritative schema;
 * strings remain immutable values, without an encoded whole-request copy.
 */
export const captureSemanticRequest = (input, schema) => {
  if (input && typeof input === 'object' && snapshots.get(input) === schema) return input;
  let result;
  const active = new Set(), pending = [{ kind: 'value', value: input, schema, assign: value => { result = value; } }];
  while (pending.length) {
    const task = pending.pop();
    if (task.kind === 'complete') {
      Object.freeze(task.output); active.delete(task.input); continue;
    }
    if (task.kind === 'item') {
      if (task.index === task.length) {
        for (const key in task.input) {
          if (!Object.hasOwn(task.input, key)) continue;
          const index = Number(key);
          if (!Number.isSafeInteger(index) || index < 0 || index >= task.length || String(index) !== key) {
            throw fail('Decorated semantic request arrays are not JSON.');
          }
        }
        if (Object.getOwnPropertySymbols(task.input).length) throw fail('Semantic request symbols are not JSON.');
        continue;
      }
      const index = task.index++, descriptor = Object.getOwnPropertyDescriptor(task.input, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw fail('Sparse/accessor semantic request arrays are not JSON.');
      pending.push(task, { kind: 'value', value: descriptor.value, schema: task.itemSchema,
        assign: value => { task.output[index] = value; } });
      continue;
    }
    const value = task.value;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) { task.assign(value); continue; }
    if (typeof value !== 'object') throw fail('Semantic requests require explicit JSON values.');
    if (active.has(value)) throw fail('Semantic request cycles are not JSON.');
    const array = Array.isArray(value), shapes = shapesFor(task.schema, array ? 'array' : 'object');
    if (!shapes.length) throw fail('Semantic request container differs from its schema.');
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw fail('Semantic requests require plain objects.');
    active.add(value);
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
      const maximum = Math.max(...shapes.map(arrayBound));
      if (!Number.isSafeInteger(length) || length < 0 || length > maximum) throw fail('Semantic request array exceeds its declared cardinality.');
      const output = new Array(length), itemSchema = { anyOf: shapes.map(shape => shape.items) };
      task.assign(output);
      pending.push({ kind: 'complete', input: value, output },
        { kind: 'item', input: value, output, index: 0, length, itemSchema });
      continue;
    }
    const properties = new Map(), required = new Set(shapes.flatMap(shape => shape.required || []));
    for (const shape of shapes) for (const [key, child] of Object.entries(shape.properties || {})) {
      if (!properties.has(key)) properties.set(key, []);
      properties.get(key).push(child);
    }
    const output = {}, children = [];
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      if (!properties.has(key)) throw fail('Unknown semantic request field: ' + key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw fail('Semantic request accessors are not JSON.');
      // Ajv treats an optional undefined property as omitted. Preserve that
      // established programmatic admission; required/unknown fields stay strict.
      if (descriptor.value === undefined && !required.has(key)) continue;
      children.push({ kind: 'value', value: descriptor.value, schema: { anyOf: properties.get(key) },
        assign: child => { output[key] = child; } });
    }
    if (Object.getOwnPropertySymbols(value).length) throw fail('Semantic request symbols are not JSON.');
    task.assign(output);
    pending.push({ kind: 'complete', input: value, output }, ...children);
  }
  if (result && typeof result === 'object') snapshots.set(result, schema);
  return result;
};
