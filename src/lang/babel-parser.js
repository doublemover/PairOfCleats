import { parse } from '@babel/parser';

const TS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const JSX_LIKE = /<([A-Za-z][A-Za-z0-9]*)\b[^>]*\/?>/;
const FLOW_DIRECTIVE = /@flow\b/;
const NOFLOW_DIRECTIVE = /@noflow\b/;

const BASE_PLUGINS = [
  'decorators-legacy',
  'classProperties',
  'classPrivateProperties',
  'classPrivateMethods',
  'classStaticBlock',
  'dynamicImport',
  'importMeta',
  'optionalChaining',
  'nullishCoalescingOperator',
  'objectRestSpread',
  'topLevelAwait',
  'numericSeparator',
  'logicalAssignment',
  'privateIn',
  'exportDefaultFrom',
  'exportNamespaceFrom'
];

function shouldEnableFlow(text, flowMode) {
  if (flowMode === true || flowMode === 'on') return true;
  if (flowMode === false || flowMode === 'off') return false;
  if (NOFLOW_DIRECTIVE.test(text)) return false;
  return FLOW_DIRECTIVE.test(text);
}

function shouldEnableJsx(ext, text, isTypeScript) {
  if (isTypeScript) return ext === '.tsx';
  if (ext === '.jsx') return true;
  return JSX_LIKE.test(text);
}

export function parseBabelAst(text, options = {}) {
  const ext = typeof options.ext === 'string' ? options.ext.toLowerCase() : '';
  const flowMode = options.flowMode ?? 'auto';
  const isTypeScript = options.mode === 'typescript' || TS_EXTS.has(ext);
  const plugins = [...BASE_PLUGINS];
  if (shouldEnableJsx(ext, text, isTypeScript)) plugins.push('jsx');
  if (isTypeScript) {
    plugins.push('typescript');
  } else if (shouldEnableFlow(text, flowMode)) {
    plugins.push('flow', 'flowComments');
  }

  try {
    const ast = parse(text, {
      sourceType: 'unambiguous',
      errorRecovery: true,
      ranges: true,
      tokens: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      plugins
    });
    if (ast && ast.type === 'File' && ast.program) {
      if (ast.tokens && !ast.program.tokens) {
        ast.program.tokens = ast.tokens;
      }
      return ast.program;
    }
    return ast || null;
  } catch {
    return null;
  }
}
