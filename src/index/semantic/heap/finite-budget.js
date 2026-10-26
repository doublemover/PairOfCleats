import { canonicalSemanticJson } from '../identity.js';

// Internal allowances for the supplied model, independent of its existing
// semantic cell/value cardinalities. These describe logical bytes/work, not RSS.
export const FINITE_HEAP_LIMITS = Object.freeze({ maxBytes: 8 * 1024 * 1024,
  maxValueReferences: 65536, maxWork: 1000000, maxReadCacheBytes: 8 * 1024 * 1024, maxReadCacheEntries: 32 });
export const finiteHeapBudgetError = (phase, allowance) => Object.assign(
  new RangeError(`Finite heap ${phase} exceeds its ${allowance} allowance.`),
  { code: 'ERR_FINITE_HEAP_BUDGET', phase, allowance });

/** @typedef {{work:number,valueReferences:number,valueBytes:number,inputBytes:number}} HeapOperationWork */
/** @typedef {{step:Function,input:Function,value:Function,encode:Function,encodeInput:Function,snapshot:()=>HeapOperationWork}} HeapOperationBudget */
/** One operation's input, candidate-union and structural work admission. */
export const createFiniteHeapBudget = (phase, limits = FINITE_HEAP_LIMITS) => {
  if (Object.keys(FINITE_HEAP_LIMITS).some(name => !Number.isSafeInteger(limits[name]) || limits[name] < 1
    || limits[name] > FINITE_HEAP_LIMITS[name])) throw new TypeError('Finite heap allowances must be positive bounded integers.');
  const work = { work: 0, valueReferences: 0, valueBytes: 0, inputBytes: 0 };
  const step = (count = 1) => {
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('Finite heap work charge must be a nonnegative safe integer.');
    if (count > limits.maxWork - work.work) throw finiteHeapBudgetError(phase, 'structural-work');
    work.work += count;
  };
  const input = bytes => {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError('Finite heap input charge must be a nonnegative safe integer.');
    step();
    if (bytes > limits.maxBytes - work.inputBytes) throw finiteHeapBudgetError(phase, 'aggregate-input-bytes');
    work.inputBytes += bytes;
  };
  const value = item => {
    step();
    if (++work.valueReferences > limits.maxValueReferences) throw finiteHeapBudgetError(phase, 'value-references');
    const bytes = Buffer.byteLength(item);
    if (bytes > limits.maxBytes - work.valueBytes) throw finiteHeapBudgetError(phase, 'candidate-value-bytes');
    work.valueBytes += bytes;
  };
  const encode = (item, { reserveBytes = 0 } = {}) => {
    if (!Number.isSafeInteger(reserveBytes) || reserveBytes < 0 || reserveBytes >= limits.maxBytes) throw finiteHeapBudgetError(phase, 'reserved-envelope-bytes');
    return canonicalSemanticJson(item, { maxBytes: limits.maxBytes - reserveBytes, check: () => step() });
  };
  const encodeInput = item => {
    const remaining = limits.maxBytes - work.inputBytes;
    if (remaining < 1) throw finiteHeapBudgetError(phase, 'aggregate-input-bytes');
    return canonicalSemanticJson(item, { maxBytes: remaining, check: () => step() });
  };
  return { step, input, value, encode, encodeInput, snapshot: () => ({ ...work }) };
};

/** Capture once through the existing passive encoder before allocating derived
 * property maps, value sets or clones. Repeated logical references still count. */
export const captureFiniteHeapInput = (input, budget) => {
  const encoded = budget.encodeInput(input); budget.input(Buffer.byteLength(encoded));
  return JSON.parse(encoded);
};

/** Snapshot a small operation envelope without traversing a deferred version
 * that already has private immutable admission. No getter is evaluated. */
export const captureFiniteHeapFields = (input, allowed, required, budget) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new TypeError('Plain finite heap operation input required.');
  const output = {};
  for (const name in input) {
    budget.step(); if (!Object.hasOwn(input, name)) continue;
    if (!allowed.includes(name)) throw new TypeError('Unknown finite heap operation field.');
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Finite heap operation accessors are not data.');
    if (descriptor.value !== undefined || required.includes(name)) Object.defineProperty(output, name, {
      value: descriptor.value, enumerable: true, configurable: true, writable: true
    });
  }
  if (Object.getOwnPropertySymbols(input).length || required.some(name => !Object.hasOwn(output, name))) throw new TypeError('Finite heap operation fields are incomplete.');
  return output;
};
