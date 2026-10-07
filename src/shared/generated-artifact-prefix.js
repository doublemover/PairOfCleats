const MAX_PREFIX_CHARACTERS = 8192;
const MAX_PREFIX_DEPTH = 256;
const SIMPLE_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't']);
const isDigit = (char) => char >= '0' && char <= '9';
const isWhitespace = (char) => char === ' ' || char === '\t' || char === '\n' || char === '\r';

/** Validate one JSON string without losing an earlier error when its tail is cut. */
const readString = (text, start) => {
  let position = start + 1;
  while (position < text.length) {
    const char = text[position++];
    if (char === '"') return { position, complete: true };
    if (char.charCodeAt(0) < 0x20) return null;
    if (char !== '\\') continue;
    if (position === text.length) return { position, complete: false };
    const escape = text[position++];
    if (SIMPLE_ESCAPES.has(escape)) continue;
    if (escape !== 'u') return null;
    for (let digit = 0; digit < 4; digit += 1) {
      if (position === text.length) return { position, complete: false };
      if (!/[0-9a-fA-F]/.test(text[position++])) return null;
    }
  }
  return { position, complete: false };
};

const readNumber = (text, start) => {
  let position = start;
  if (text[position] === '-') position += 1;
  if (position === text.length) return { position, complete: false };
  if (text[position] === '0') {
    position += 1;
  } else {
    if (text[position] < '1' || text[position] > '9') return null;
    while (isDigit(text[position])) position += 1;
  }
  if (text[position] === '.') {
    position += 1;
    if (position === text.length) return { position, complete: false };
    if (!isDigit(text[position])) return null;
    while (isDigit(text[position])) position += 1;
  }
  if (text[position] === 'e' || text[position] === 'E') {
    position += 1;
    if (text[position] === '+' || text[position] === '-') position += 1;
    if (position === text.length) return { position, complete: false };
    if (!isDigit(text[position])) return null;
    while (isDigit(text[position])) position += 1;
  }
  return { position, complete: true };
};

/**
 * Recognize a valid object document or a prefix that could become one solely by
 * appending bytes. No parser recovery is allowed inside the visible prefix.
 * `complete` means the caller read fewer bytes than its cap, so truncation is not
 * an explanation for missing tokens. String indices are decoded UTF-16 indices,
 * independent of the caller's UTF-8 byte budget.
 */
const isValidObjectPrefix = (text, complete) => {
  if (typeof text !== 'string' || text.length > MAX_PREFIX_CHARACTERS) return false;
  let position = 0;
  while (isWhitespace(text[position])) position += 1;
  if (text[position] !== '{') return false;
  const frames = [];
  let rootConsumed = false;
  const consumeValue = () => {
    if (frames.length) frames.at(-1).state = 'comma-or-end';
    else rootConsumed = true;
  };
  while (position < text.length) {
    const char = text[position];
    if (isWhitespace(char)) {
      position += 1;
      continue;
    }
    const frame = frames.at(-1);
    if (!frame && rootConsumed) return false;
    if (frame?.state === 'comma-or-end') {
      if (char === frame.end) {
        frames.pop();
        position += 1;
        continue;
      }
      if (char !== ',') return false;
      frame.state = frame.type === 'object' ? 'key' : 'value';
      position += 1;
      continue;
    }
    if (frame?.state === 'colon') {
      if (char !== ':') return false;
      frame.state = 'value';
      position += 1;
      continue;
    }
    if (frame?.state === 'key-or-end' || frame?.state === 'key') {
      if (char === '}' && frame.state === 'key-or-end') {
        frames.pop();
        position += 1;
        continue;
      }
      if (char !== '"') return false;
      const token = readString(text, position);
      if (!token) return false;
      if (!token.complete) return !complete;
      const key = JSON.parse(text.slice(position, token.position));
      if (frame.keys.has(key)) return false;
      frame.keys.add(key);
      frame.state = 'colon';
      position = token.position;
      continue;
    }
    if (frame?.state === 'value-or-end' && char === ']') {
      frames.pop();
      position += 1;
      continue;
    }
    if (char === '{' || char === '[') {
      consumeValue();
      if (frames.length >= MAX_PREFIX_DEPTH) return false;
      frames.push(char === '{'
        ? { type: 'object', state: 'key-or-end', end: '}', keys: new Set() }
        : { type: 'array', state: 'value-or-end', end: ']' });
      position += 1;
      continue;
    }
    if (char === '"' || char === '-' || isDigit(char)) {
      const token = char === '"' ? readString(text, position) : readNumber(text, position);
      if (!token) return false;
      if (!token.complete) return !complete;
      consumeValue();
      position = token.position;
      continue;
    }
    const literal = char === 't' ? 'true' : (char === 'f' ? 'false' : (char === 'n' ? 'null' : null));
    if (!literal) return false;
    const tail = text.slice(position, position + literal.length);
    if (tail !== literal) return !complete && literal.startsWith(tail);
    consumeValue();
    position += literal.length;
  }
  return rootConsumed && (!complete || frames.length === 0);
};

export const hasAmbiguousGeneratedArtifactPrefix = (text, complete) => {
  try {
    return !isValidObjectPrefix(text, complete);
  } catch {
    return true;
  }
};
