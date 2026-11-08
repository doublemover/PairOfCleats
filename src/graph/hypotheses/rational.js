const gcd = (a, b) => { while (b) { const rest = a % b; a = b; b = rest; } return a; };
const bounded = (numerator, denominator) => {
  if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint' || numerator < 0n || denominator <= 0n) {
    throw Object.assign(new TypeError('Nonnegative exact rational with positive denominator required.'), { code: 'ERR_FINITE_CAUSAL_CONTRACT' });
  }
  const divisor = gcd(numerator, denominator); numerator /= divisor; denominator /= divisor;
  if (numerator.toString(2).length > 4096 || denominator.toString(2).length > 4096) {
    throw Object.assign(new RangeError('Finite-model exact rational allowance exceeded.'), { code: 'ERR_FINITE_CAUSAL_RATIONAL_LIMIT' });
  }
  return Object.freeze({ numerator, denominator });
};
export const rationalZero = () => bounded(0n, 1n);
export const readRational = input => {
  if (!input || typeof input.numerator !== 'string' || typeof input.denominator !== 'string'
    || !/^(0|[1-9][0-9]{0,63})$/.test(input.numerator) || !/^[1-9][0-9]{0,63}$/.test(input.denominator)) {
    throw Object.assign(new TypeError('Bounded encoded nonnegative exact rational required.'), { code: 'ERR_FINITE_CAUSAL_CONTRACT' });
  }
  return bounded(BigInt(input.numerator), BigInt(input.denominator));
};
export const addRationals = (a, b) => {
  const divisor = gcd(a.denominator, b.denominator), left = a.denominator / divisor, right = b.denominator / divisor;
  return bounded(a.numerator * right + b.numerator * left, left * b.denominator);
};
export const divideRationals = (a, b) => {
  if (b.numerator === 0n) throw new RangeError('Cannot condition on zero probability mass.');
  return bounded(a.numerator * b.denominator, a.denominator * b.numerator);
};
export const encodeRational = value => Object.freeze({ numerator: String(value.numerator), denominator: String(value.denominator) });
