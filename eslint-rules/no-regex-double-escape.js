const TARGET_ESCAPES = new Set([
  's',
  'S',
  'd',
  'D',
  'w',
  'W',
  'b',
  'B',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '+',
  '*',
  '?',
  '|',
  '^',
  '$'
]);

const buildFixedPattern = (pattern) => {
  let changed = false;
  let out = '';
  let inCharClass = false;

  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];

    if (ch === '\\') {
      const next = pattern[i + 1];
      const nextNext = pattern[i + 2];
      if (!inCharClass && next === '\\' && nextNext && TARGET_ESCAPES.has(nextNext)) {
        out += `\\${nextNext}`;
        i += 2;
        changed = true;
        continue;
      }
      if (next) {
        out += ch + next;
        i += 1;
      } else {
        out += ch;
      }
      continue;
    }

    if (ch === '[' && !inCharClass) {
      inCharClass = true;
    } else if (ch === ']' && inCharClass) {
      inCharClass = false;
    }

    out += ch;
  }

  return changed ? out : null;
};

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow double-escaped tokens in regex literals'
    },
    fixable: 'code',
    schema: [],
    messages: {
      doubleEscape: 'Use single-escaped tokens in regex literals (e.g., \\s instead of \\\\s).'
    }
  },
  create(context) {
    const sourceCode = context.getSourceCode();
    return {
      Literal(node) {
        if (!node.regex) return;
        const raw = sourceCode.getText(node);
        if (!raw.startsWith('/')) return;
        const lastSlash = raw.lastIndexOf('/');
        if (lastSlash <= 0) return;
        const pattern = raw.slice(1, lastSlash);
        const fixedPattern = buildFixedPattern(pattern);
        if (!fixedPattern) return;
        const flags = raw.slice(lastSlash + 1);
        context.report({
          node,
          messageId: 'doubleEscape',
          fix: (fixer) => fixer.replaceText(node, `/${fixedPattern}/${flags}`)
        });
      }
    };
  }
};
