const splitNodeOptions = (options) => String(options || '')
  .trim()
  .split(/\s+/)
  .filter(Boolean);

const joinNodeOptions = (tokens) => tokens.filter(Boolean).join(' ').trim();

const consumeOptionalValue = (tokens, index) => {
  const next = tokens[index + 1];
  if (typeof next !== 'string' || !next || next.startsWith('--')) return index;
  return index + 1;
};

const sanitizeNodeOptionsTokens = (
  options,
  {
    stripHeap = false,
    stripInspector = false
  } = {}
) => {
  const tokens = splitNodeOptions(options);
  if (!tokens.length) return '';
  const sanitized = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const dropHeap = stripHeap && (
      token === '--max-old-space-size'
      || token.startsWith('--max-old-space-size=')
    );
    const dropInspector = stripInspector && (
      token === '--inspect'
      || token.startsWith('--inspect=')
      || token === '--inspect-brk'
      || token.startsWith('--inspect-brk=')
      || token === '--inspect-wait'
      || token.startsWith('--inspect-wait=')
      || token === '--inspect-port'
      || token.startsWith('--inspect-port=')
      || token === '--inspect-publish-uid'
      || token.startsWith('--inspect-publish-uid=')
    );
    if (!dropHeap && !dropInspector) {
      sanitized.push(token);
      continue;
    }
    if (!token.includes('=')) {
      i = consumeOptionalValue(tokens, i);
    }
  }
  return joinNodeOptions(sanitized);
};

export const stripMaxOldSpaceFlag = (options) => sanitizeNodeOptionsTokens(options, {
  stripHeap: true
});

export const stripNodeInspectorFlags = (options) => sanitizeNodeOptionsTokens(options, {
  stripInspector: true
});

export const sanitizeBenchNodeOptions = (
  options,
  {
    stripHeap = false
  } = {}
) => sanitizeNodeOptionsTokens(options, {
  stripHeap,
  stripInspector: true
});
