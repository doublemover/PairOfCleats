const TS_MODIFIERS = new Set([
  'public', 'private', 'protected', 'static', 'readonly', 'abstract', 'declare',
  'async', 'export', 'default', 'override'
]);

const TS_CALL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'case', 'return', 'new', 'throw', 'catch',
  'try', 'else', 'do', 'typeof', 'instanceof', 'await', 'yield'
]);

const TS_USAGE_SKIP = new Set([
  ...TS_CALL_KEYWORDS,
  'class', 'interface', 'enum', 'type', 'namespace', 'module', 'void',
  'string', 'number', 'boolean', 'any', 'unknown', 'never', 'null', 'undefined',
  'true', 'false', 'object', 'symbol', 'bigint'
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
  TS_USAGE_SKIP,
  TSX_CLOSE_TAG,
  TSX_FRAGMENT_CLOSE,
  TSX_FRAGMENT_OPEN,
  TSX_SELF_CLOSING
};
