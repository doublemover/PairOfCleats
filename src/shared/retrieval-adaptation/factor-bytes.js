import { createHash } from 'node:crypto';
import { captureAdaptationNumbers } from './numeric.js';
const fail = message => Object.assign(new Error(message), { code: 'ERR_RETRIEVAL_ADAPTATION' });
const bytesHash = bytes => createHash('sha256').update(bytes).digest('hex');

export const encodeAdaptationFactors = (input, length) => {
  const numbers = captureAdaptationNumbers(input, length), bytes = Buffer.alloc(length * 4);
  for (let index = 0; index < length; index++) bytes.writeFloatLE(numbers[index], index * 4);
  return Object.freeze({ encoding: 'float32-le-base64', sha256: bytesHash(bytes), data: bytes.toString('base64') });
};
export const decodeAdaptationFactors = (factor, length) => {
  const bytes = Buffer.from(factor.data, 'base64');
  if (bytes.length !== length * 4 || bytes.toString('base64') !== factor.data || bytesHash(bytes) !== factor.sha256) throw fail('Factor encoding, byte extent or SHA-256 changed.');
  const values = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const value = bytes.readFloatLE(index * 4);
    if (!Number.isFinite(value) || Object.is(value, -0)) throw fail('Factors require canonical finite Float32 bytes.');
    values[index] = value;
  }
  return values;
};
