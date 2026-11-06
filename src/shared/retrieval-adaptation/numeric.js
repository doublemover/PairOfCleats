import { types } from 'node:util';
const fail = message => Object.assign(new Error(message), { code: 'ERR_RETRIEVAL_ADAPTATION' });

/** Private owned Float32 snapshot: no iterator callbacks, getters, holes,
 * proxies, shared backing memory or caller mutation after admission.
 */
export const captureAdaptationNumbers = (input, length) => {
  if (!Number.isSafeInteger(length) || length < 1 || length > 262144 || !input || typeof input !== 'object' || types.isProxy(input)
    || ![Array.prototype, Float32Array.prototype, Float64Array.prototype].includes(Object.getPrototypeOf(input))
    || input.length !== length || ArrayBuffer.isView(input) && input.buffer instanceof SharedArrayBuffer) throw fail('Exact bounded private numerical storage required.');
  const numbers = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index)), value = descriptor?.value;
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof value !== 'number' || !Number.isFinite(value)
      || !Number.isFinite(Math.fround(value))) throw fail('Finite Float32 values without accessors or holes required.');
    const rounded = Math.fround(value); numbers[index] = rounded === 0 ? 0 : rounded;
  }
  return numbers;
};

/** Internal numeric seam shared by inference and training. Callers must own
 * and admit input/factor storage and enforce the directional contracts first.
 */
export const applyResidualQueryKernel = ({ input, u, v, dimensions: d, rank: r }) => {
  const middle = new Float64Array(r), projected = new Float64Array(d);
  for (let row = 0; row < d; row++) for (let column = 0; column < r; column++) middle[column] += v[row * r + column] * input[row];
  let norm = 0;
  for (let row = 0; row < d; row++) {
    let value = input[row];
    for (let column = 0; column < r; column++) value += u[row * r + column] * middle[column];
    if (!Number.isFinite(value)) throw fail('Residual query is nonfinite.');
    projected[row] = value; norm = Math.hypot(norm, value);
  }
  if (!(norm > 0) || !Number.isFinite(norm)) throw fail('Residual query has zero or invalid norm.');
  return { vector: Float32Array.from(projected, value => value / norm), middle, projected, norm };
};
