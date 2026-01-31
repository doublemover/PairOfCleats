const TS_MODIFIERS = new Set([
  'public', 'private', 'protected', 'static', 'readonly', 'abstract', 'declare',
  'async', 'export', 'default', 'override'
]);

const TS_RESERVED_WORDS = new Set([
  'abstract',
  'any',
  'as',
  'asserts',
  'async',
  'await',
  'bigint',
  'boolean',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'constructor',
  'continue',
  'debugger',
  'declare',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'get',
  'if',
  'implements',
  'import',
  'in',
  'infer',
  'instanceof',
  'interface',
  'is',
  'keyof',
  'let',
  'module',
  'namespace',
  'never',
  'new',
  'null',
  'number',
  'object',
  'of',
  'override',
  'package',
  'private',
  'protected',
  'public',
  'readonly',
  'require',
  'return',
  'satisfies',
  'set',
  'static',
  'string',
  'super',
  'switch',
  'symbol',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'unknown',
  'var',
  'void',
  'while',
  'with',
  'yield'
]);

const TS_CALL_KEYWORDS = new Set([
  ...TS_RESERVED_WORDS
]);

const TS_USAGE_SKIP = new Set([
  ...TS_RESERVED_WORDS,
  'undefined'
]);

const TSX_CLOSE_TAG = /<\/[A-Za-z]/;
const TSX_SELF_CLOSING = /<([A-Za-z][A-Za-z0-9]*)\b[^>]*\/>/;
const TSX_FRAGMENT_OPEN = /<>/;
const TSX_FRAGMENT_CLOSE = /<\/>/;

const TS_PARSERS = new Set(['auto', 'typescript', 'babel', 'heuristic']);

export {
  TS_CALL_KEYWORDS,
  TS_MODIFIERS,
  TS_PARSERS,
  TS_RESERVED_WORDS,
  TS_USAGE_SKIP,
  TSX_CLOSE_TAG,
  TSX_FRAGMENT_CLOSE,
  TSX_FRAGMENT_OPEN,
  TSX_SELF_CLOSING
};
