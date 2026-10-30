import { assertMissingValueFlags } from './helpers/missing-value-flags.js';
const flag = assertMissingValueFlags(1);
console.log('Missing search value ' + flag + ' passed');
