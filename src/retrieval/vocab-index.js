import { types } from 'node:util';

const ARRAY_MAP = Array.prototype.map;
const ARRAY_FOR_EACH = Array.prototype.forEach;

/** Build a vocabulary Map without temporary pairs for ordinary arrays. */
export const createVocabIndex = (vocab) => {
  const map = vocab.map;
  const canBuildDirectly = Array.isArray(vocab) && !types.isProxy(vocab)
    && Object.getPrototypeOf(vocab) === Array.prototype
    && !Object.hasOwn(vocab, 'map') && !Object.hasOwn(vocab, 'constructor')
    && map === ARRAY_MAP
    && Object.getOwnPropertyDescriptor(Array.prototype, 'constructor')?.value === Array;
  if (!canBuildDirectly) {
    return new Map(Reflect.apply(map, vocab, [(term, index) => [term, index]]));
  }
  const length = vocab.length;
  const index = new Map();
  let visited = 0;
  ARRAY_FOR_EACH.call(vocab, (term, position) => {
    index.set(term, position);
    visited += 1;
  });
  if (visited !== length) {
    // The previous mapped array's holes were invalid Map entries. Preserve the
    // native error after visiting every source element, without publishing a Map.
    return new Map([undefined]);
  }
  return index;
};
