const normalizeInput = (value) => (typeof value === 'string' ? value : String(value || ''));

const walkTopLevel = (value, onChar, { angleBrackets = true, rustLifetimes = false } = {}) => {
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

    const rustCharacter = rustLifetimes && ch === '\''
      && /^'(?:\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|[^\r\n])|[^'\\\r\n])'/u.test(source.slice(i));
    if (ch === '"' || (ch === '\'' && (!rustLifetimes || rustCharacter)) || ch === '`') {
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

    if (angleBrackets && ch === '<') depthAngle += 1;
    if (angleBrackets && ch === '>' && depthAngle > 0 && !(rustLifetimes && source[i - 1] === '-')) depthAngle -= 1;
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

export const splitTopLevel = (value, separator = ',', options = {}) => {
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
  }, options);

  const tail = current.trim();
  if (tail) parts.push(tail);
  return parts;
};

export const findTopLevelIndex = (value, targetChar, options = {}) => {
  const source = normalizeInput(value);
  let found = -1;

  walkTopLevel(source, (ch, index, state) => {
    if (found !== -1) return;
    if (ch === targetChar && isTopLevel(state)) {
      found = index;
    }
  }, options);

  return found;
};

export const stripTopLevelAssignment = (value, options = {}) => {
  const source = normalizeInput(value);
  const idx = findTopLevelIndex(source, '=', options);
  return idx === -1 ? source : source.slice(0, idx);
};
