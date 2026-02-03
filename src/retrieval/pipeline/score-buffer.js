const BUFFER_TAG = Symbol('scoreBufferPoolId');

class ScoreBuffer {
  constructor(fields = ['idx', 'score'], capacity = 0) {
    this.fields = fields;
    this.entries = new Array(Math.max(0, Math.floor(Number(capacity) || 0)));
    this.count = 0;
    this[BUFFER_TAG] = null;
  }

  ensureCapacity(capacity) {
    const needed = Math.max(0, Math.floor(Number(capacity) || 0));
    if (this.entries.length < needed) {
      this.entries.length = needed;
    }
  }

  reset() {
    this.count = 0;
    return this;
  }

  push(values) {
    const index = this.count++;
    let entry = this.entries[index];
    if (!entry) {
      entry = {};
      this.entries[index] = entry;
    }
    for (const field of this.fields) {
      entry[field] = values[field] ?? null;
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

  const keyForFields = (fields) => fields.join('|');

  const acquire = ({ fields = ['idx', 'score'], capacity = 0 } = {}) => {
    const key = keyForFields(fields);
    let bucket = buffers.get(key);
    let buffer = bucket && bucket.length ? bucket.pop() : null;
    if (buffer) {
      stats.reuses += 1;
      buffer.reset();
    } else {
      stats.allocations += 1;
      buffer = new ScoreBuffer(fields, capacity);
    }
    buffer.ensureCapacity(capacity);
    buffer[BUFFER_TAG] = poolId;
    buffer.fields = fields;
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
    const key = keyForFields(buffer.fields);
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
