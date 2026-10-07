import { formatHash64, parseHash64 } from './token-hash.js';

const TYPED_MAP_DEFAULT_CAPACITY = 1024;
const TYPED_MAP_MAX_LOAD = 0.72;
const TYPED_MAP_EMPTY = 0;
const TYPED_MAP_USED = 1;

const normalizeTypedMapCapacity = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return TYPED_MAP_DEFAULT_CAPACITY;
  let cap = 1;
  const target = Math.max(16, Math.floor(parsed));
  while (cap < target) cap <<= 1;
  return cap;
};

const hash64ToIndex = (value, mask) => {
  const mixed = (value ^ (value >> 33n) ^ (value >> 17n)) & BigInt(mask);
  return Number(mixed);
};

export class OpenAddressedTokenPostingMap {
  constructor({ initialCapacity = TYPED_MAP_DEFAULT_CAPACITY, maxLoad = TYPED_MAP_MAX_LOAD } = {}) {
    const capacity = normalizeTypedMapCapacity(initialCapacity);
    this._capacity = capacity;
    this._mask = capacity - 1;
    this._states = new Uint8Array(capacity);
    this._keys = new BigUint64Array(capacity);
    this._keyStrings = new Array(capacity);
    this._values = new Array(capacity);
    this._size = 0;
    this._maxLoad = Number.isFinite(Number(maxLoad))
      ? Math.min(0.95, Math.max(0.5, Number(maxLoad)))
      : TYPED_MAP_MAX_LOAD;
  }

  get size() {
    return this._size;
  }

  clear() {
    this._states.fill(TYPED_MAP_EMPTY);
    this._keys.fill(0n);
    this._keyStrings = new Array(this._capacity);
    this._values = new Array(this._capacity);
    this._size = 0;
  }

  has(key) {
    return this._findSlot(parseHash64(key), false) >= 0;
  }

  get(key) {
    const slot = this._findSlot(parseHash64(key), false);
    return slot >= 0 ? this._values[slot] : undefined;
  }

  set(key, value) {
    this._ensureCapacity(this._size + 1);
    const normalized = parseHash64(key);
    const canonical = formatHash64(normalized);
    const slot = this._findSlot(normalized, true);
    const isNew = this._states[slot] !== TYPED_MAP_USED;
    if (isNew) {
      this._states[slot] = TYPED_MAP_USED;
      this._keys[slot] = normalized;
      this._keyStrings[slot] = canonical;
      this._size += 1;
    }
    this._values[slot] = value;
    return this;
  }

  delete(key) {
    const normalized = parseHash64(key);
    const slot = this._findSlot(normalized, false);
    if (slot < 0) return false;
    this._states[slot] = TYPED_MAP_EMPTY;
    this._keys[slot] = 0n;
    this._keyStrings[slot] = undefined;
    this._values[slot] = undefined;
    this._size -= 1;
    this._rehashInPlace();
    return true;
  }

  *keys() {
    for (let i = 0; i < this._capacity; i += 1) {
      if (this._states[i] !== TYPED_MAP_USED) continue;
      yield this._keyStrings[i];
    }
  }

  *values() {
    for (let i = 0; i < this._capacity; i += 1) {
      if (this._states[i] !== TYPED_MAP_USED) continue;
      yield this._values[i];
    }
  }

  *entries() {
    for (let i = 0; i < this._capacity; i += 1) {
      if (this._states[i] !== TYPED_MAP_USED) continue;
      yield [this._keyStrings[i], this._values[i]];
    }
  }

  [Symbol.iterator]() {
    return this.entries();
  }

  forEach(fn, thisArg = undefined) {
    if (typeof fn !== 'function') return;
    for (let i = 0; i < this._capacity; i += 1) {
      if (this._states[i] !== TYPED_MAP_USED) continue;
      fn.call(thisArg, this._values[i], this._keyStrings[i], this);
    }
  }

  _findSlot(key, forInsert) {
    let slot = hash64ToIndex(key, this._mask);
    for (let i = 0; i < this._capacity; i += 1) {
      const state = this._states[slot];
      if (state !== TYPED_MAP_USED) {
        return forInsert ? slot : -1;
      }
      if (this._keys[slot] === key) return slot;
      slot = (slot + 1) & this._mask;
    }
    return -1;
  }

  _ensureCapacity(nextSize) {
    if (nextSize <= Math.floor(this._capacity * this._maxLoad)) return;
    this._resize(this._capacity << 1);
  }

  _resize(nextCapacityRaw) {
    const nextCapacity = normalizeTypedMapCapacity(nextCapacityRaw);
    const prevStates = this._states;
    const prevKeys = this._keys;
    const prevKeyStrings = this._keyStrings;
    const prevValues = this._values;

    this._capacity = nextCapacity;
    this._mask = nextCapacity - 1;
    this._states = new Uint8Array(nextCapacity);
    this._keys = new BigUint64Array(nextCapacity);
    this._keyStrings = new Array(nextCapacity);
    this._values = new Array(nextCapacity);
    const priorSize = this._size;
    this._size = 0;

    for (let i = 0; i < prevStates.length; i += 1) {
      if (prevStates[i] !== TYPED_MAP_USED) continue;
      const key = prevKeys[i];
      let slot = hash64ToIndex(key, this._mask);
      while (this._states[slot] === TYPED_MAP_USED) {
        slot = (slot + 1) & this._mask;
      }
      this._states[slot] = TYPED_MAP_USED;
      this._keys[slot] = key;
      this._keyStrings[slot] = prevKeyStrings[i];
      this._values[slot] = prevValues[i];
      this._size += 1;
    }

    if (this._size !== priorSize) {
      this._size = priorSize;
    }
  }

  _rehashInPlace() {
    const entries = Array.from(this.entries());
    this._states.fill(TYPED_MAP_EMPTY);
    this._keys.fill(0n);
    this._keyStrings = new Array(this._capacity);
    this._values = new Array(this._capacity);
    this._size = 0;
    for (const [key, value] of entries) {
      this.set(key, value);
    }
  }
}

export const createTypedTokenPostingMap = (options = {}) => new OpenAddressedTokenPostingMap(options);
