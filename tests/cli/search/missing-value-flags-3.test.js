import { assertMissingValueFlags } from './helpers/missing-value-flags.js';
const flag = assertMissingValueFlags(2);
console.log('Missing search value ' + flag + ' passed');
