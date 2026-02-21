const guardState = new WeakMap();

const normalizeChunk = (chunk) => {
  if (chunk == null) return '';
  if (Buffer.isBuffer(chunk)) return chunk.toString('utf8');
  return String(chunk);
};

const readState = (stream) => {
  const state = guardState.get(stream);
  if (state) return state;
  const created = { writes: 0 };
  guardState.set(stream, created);
  return created;
};

export const createStdoutGuard = ({ enabled = false, stream = process.stdout, label = 'stdout' } = {}) => {
  const state = readState(stream);

  const assertCanWrite = (chunk, { json = false } = {}) => {
    if (!enabled) return;
    const text = normalizeChunk(chunk).trim();
    if (state.writes > 0) {
      throw new Error(`${label} contract violation: only one write is allowed in JSON mode.`);
    }
    if (!json) {
      throw new Error(`${label} contract violation: non-JSON write attempted in JSON mode.`);
    }
    if (!text || (!text.startsWith('{') && !text.startsWith('['))) {
      throw new Error(`${label} contract violation: expected JSON payload on stdout.`);
    }
  };

  const writeJson = (payload, { pretty = true } = {}) => {
    const text = pretty
      ? JSON.stringify(payload, null, 2)
      : JSON.stringify(payload);
    assertCanWrite(text, { json: true });
    state.writes += 1;
    stream.write(`${text}\n`);
  };

  const writeText = (text) => {
    const normalized = normalizeChunk(text);
    assertCanWrite(normalized, { json: false });
    state.writes += 1;
    stream.write(normalized);
  };

  return {
    writeJson,
    writeText,
    getWriteCount: () => state.writes
  };
};
