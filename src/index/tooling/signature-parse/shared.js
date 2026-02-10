const normalizeInput = (value) => (typeof value === 'string' ? value : String(value || ''));

const walkTopLevel = (value, onChar) => {
  const source = normalizeInput(value);
  let depthAngle = 0;
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      onChar(ch, i, {
        depthAngle,
        depthParen,
        depthBracket,
        depthBrace,
        inQuote: true
      });
      continue;
    }

    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch;
      onChar(ch, i, {
        depthAngle,
        depthParen,
        depthBracket,
        depthBrace,
        inQuote: true
      });
      continue;
    }

    if (ch === '<') depthAngle += 1;
    if (ch === '>' && depthAngle > 0) depthAngle -= 1;
    if (ch === '(') depthParen += 1;
    if (ch === ')' && depthParen > 0) depthParen -= 1;
    if (ch === '[') depthBracket += 1;
    if (ch === ']' && depthBracket > 0) depthBracket -= 1;
    if (ch === '{') depthBrace += 1;
    if (ch === '}' && depthBrace > 0) depthBrace -= 1;

    onChar(ch, i, {
      depthAngle,
      depthParen,
      depthBracket,
      depthBrace,
      inQuote: false
    });
  }
};

const isTopLevel = (state) => (
  state.depthAngle === 0
  && state.depthParen === 0
  && state.depthBracket === 0
  && state.depthBrace === 0
  && !state.inQuote
);

export const splitTopLevel = (value, separator = ',') => {
  const source = normalizeInput(value);
  if (!source) return [];

  const parts = [];
  let current = '';

  walkTopLevel(source, (ch, _index, state) => {
    if (ch === separator && isTopLevel(state)) {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = '';
      return;
    }
    current += ch;
  });

  const tail = current.trim();
  if (tail) parts.push(tail);
  return parts;
};

export const findTopLevelIndex = (value, targetChar) => {
  const source = normalizeInput(value);
  let found = -1;

  walkTopLevel(source, (ch, index, state) => {
    if (found !== -1) return;
    if (ch === targetChar && isTopLevel(state)) {
      found = index;
    }
  });

  return found;
};

export const stripTopLevelAssignment = (value) => {
  const source = normalizeInput(value);
  const idx = findTopLevelIndex(source, '=');
  return idx === -1 ? source : source.slice(0, idx);
};
