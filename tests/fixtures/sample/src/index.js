import { add } from './util.js';

export function greet(name) {
  return `hello ${name}`;
}

export function sum(values) {
  return values.reduce((acc, value) => add(acc, value), 0);
}
