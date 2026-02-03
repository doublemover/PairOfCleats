const BUFFER_TAG = Symbol('scoreBufferPoolId');
const DEFAULT_NUMERIC_FIELDS = ['idx', 'score'];

class ScoreBuffer {
  constructor(fields = ['idx', 'score'], capacity = 0, numericFields = DEFAULT_NUMERIC_FIELDS) {
    this.fields = fields;
    this.numericFields = Array.isArray(numericFields) && numericFields.length
      ? numericFields
      : DEFAULT_NUMERIC_FIELDS;
    this.numericFieldSet = new Set(this.numericFields);
    this.numericArrays = {};
    this.entries = new Array(Math.max(0, Math.floor(Number(capacity) || 0)));
    this.count = 0;
    this[BUFFER_TAG] = null;
    this.ensureCapacity(capacity);
  }

  createEntry(index) {
    const entry = { __index: index };
    for (const field of this.numericFields) {
      Object.defineProperty(entry, field, {
        enumerable: true,
        get: () => this.numericArrays[field][index],
        set: (value) => {
          const numeric = Number(value);
          this.numericArrays[field][index] = Number.isFinite(numeric) ? numeric : 0;
        }
      });
    }
    return entry;
  }

  ensureCapacity(capacity) {
    const needed = Math.max(0, Math.floor(Number(capacity) || 0));
    if (this.entries.length < needed) this.entries.length = needed;
    for (const field of this.numericFields) {
      const current = this.numericArrays[field];
      if (current && current.length >= needed) continue;
      const next = new Float64Array(needed);
      if (current) next.set(current);
      this.numericArrays[field] = next;
    }
  }

  reset() {
    this.count = 0;
    return this;
  }

  push(values) {
    const index = this.count++;
    if (index >= this.entries.length) {
      this.ensureCapacity(index + 1);
    }
    let entry = this.entries[index];
    if (!entry) {
      entry = this.createEntry(index);
      this.entries[index] = entry;
    }
    for (const field of this.fields) {
      const value = values[field] ?? null;
      if (this.numericFieldSet.has(field)) {
        const numeric = Number(value);
        this.numericArrays[field][index] = Number.isFinite(numeric) ? numeric : 0;
      } else {
        entry[field] = value;
      }
    }
    return entry;
  }
}

export const createScoreBufferPool = ({
  maxBuffers = 4,
  maxEntries = 20000
} = {}) => {
  const poolId = Symbol('scoreBufferPool');
  const buffers = new Map();
  const stats = {
    allocations: 0,
    reuses: 0,
    releases: 0,
    drops: 0,
    maxEntries
  };

  const keyForFields = (fields, numericFields) => [
    fields.join('|'),
    (numericFields || DEFAULT_NUMERIC_FIELDS).join('|')
  ].join('::');

  const acquire = ({
    fields = ['idx', 'score'],
    numericFields = DEFAULT_NUMERIC_FIELDS,
    capacity = 0
  } = {}) => {
    const resolvedNumericFields = Array.isArray(numericFields) && numericFields.length
      ? numericFields
      : DEFAULT_NUMERIC_FIELDS;
    const key = keyForFields(fields, resolvedNumericFields);
    let bucket = buffers.get(key);
    let buffer = bucket && bucket.length ? bucket.pop() : null;
    if (buffer) {
      stats.reuses += 1;
      buffer.reset();
    } else {
      stats.allocations += 1;
      buffer = new ScoreBuffer(fields, capacity, resolvedNumericFields);
    }
    buffer[BUFFER_TAG] = poolId;
    buffer.fields = fields;
    buffer.numericFields = resolvedNumericFields;
    buffer.numericFieldSet = new Set(resolvedNumericFields);
    buffer.ensureCapacity(capacity);
    return buffer;
  };

  const release = (buffer) => {
    if (!buffer || buffer[BUFFER_TAG] !== poolId) return;
    stats.releases += 1;
    const size = buffer.entries.length;
    if (Number.isFinite(maxEntries) && maxEntries > 0 && size > maxEntries) {
      stats.drops += 1;
      return;
    }
    const key = keyForFields(buffer.fields, buffer.numericFields);
    const bucket = buffers.get(key) || [];
    if (bucket.length >= maxBuffers) return;
    buffer.reset();
    buffer[BUFFER_TAG] = poolId;
    buffers.set(key, bucket);
    bucket.push(buffer);
  };

  const owns = (buffer) => Boolean(buffer && buffer[BUFFER_TAG] === poolId);

  return {
    acquire,
    release,
    owns,
    stats
  };
};
