import { parseBabelAst } from '../babel-parser.js';
import { createRequire } from 'node:module';
import { loadTypeScriptModule, isLikelyTsx, resolveTypeScriptFilename } from './parser.js';

const owners = new WeakMap();
const contexts = new WeakMap();
const babelContexts = new WeakMap();
const babelOwners = new WeakMap();
const babelVersion = createRequire(import.meta.url)('@babel/parser/package.json').version;
export const getTypeScriptBabelSyntaxIdentity = (ast) => babelOwners.get(ast) || null;
export const getTypeScriptSyntaxIdentity = (sourceFile) => owners.get(sourceFile) || null;

/** A caller-owned, file-scoped cache; never retains a project or creates a Program. */
export const createTypeScriptSyntaxContext = () => ({ parses: 0, reuses: 0, babelParses: 0, babelReuses: 0 });
export const prepareTypeScriptSyntax = (text, options = {}) => {
  const ts = options.ts || loadTypeScriptModule(options.rootDir);
  if (!ts) return null;
  const tsx = isLikelyTsx(text, options.ext || '');
  const scriptKind = tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const fileName = options.fileName || options.sourceFile?.fileName || resolveTypeScriptFilename(options.ext || '', tsx);
  const supplied = options.sourceFile || options.program?.getSourceFile(fileName);
  const target = options.scriptTarget ?? supplied?.languageVersion ?? ts.ScriptTarget.Latest;
  const identity = { family: 'typescript', version: ts.version,
    options: { fileName, scriptKind, languageVersion: target,
      impliedNodeFormat: supplied?.impliedNodeFormat ?? null,
      jsDocParsingMode: supplied?.jsDocParsingMode ?? ts.JSDocParsingMode?.ParseAll ?? null, setParentNodes: supplied ? (supplied.statements.length ? supplied.statements[0].parent === supplied : null) : true } };
  const context = options.typeScriptSyntaxContext;
  const cached = context && contexts.get(context);
  if (cached && cached.ts === ts && cached.text === text
    && JSON.stringify(cached.identity) === JSON.stringify(identity)) {
    context.reuses += 1;
    return cached;
  }
  let sourceFile = supplied;
  if (sourceFile && (sourceFile.text !== text || sourceFile.scriptKind !== scriptKind
    || sourceFile.languageVersion !== target)) sourceFile = null;
  if (!sourceFile) {
    sourceFile = ts.createSourceFile(fileName, text, target, true, scriptKind);
    if (context) context.parses += 1;
  } else if (context) context.reuses += 1;
  owners.set(sourceFile, identity);
  const result = { ts, sourceFile, identity, text };
  if (context) contexts.set(context, result);
  return result;
};

/** The existing Babel relation/chunk dialect shares only compatible file-scoped syntax. */
export const prepareTypeScriptBabelSyntax = (text, options = {}) => {
  const context = options.typeScriptSyntaxContext;
  const ext = options.ext || '';
  const cached = context && babelContexts.get(context);
  if (cached?.text === text && cached.ext === ext) {
    context.babelReuses += 1;
    return cached.ast;
  }
  const ast = parseBabelAst(text, { ext, mode: 'typescript' });
  if (context) {
    context.babelParses += 1;
    babelContexts.set(context, { text, ext, ast });
  }
  if (ast) babelOwners.set(ast, { family: 'babel', version: babelVersion,
    options: { ext, mode: 'typescript', sourceType: 'unambiguous', errorRecovery: true,
      ranges: true, tokens: false, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true,
      plugins: ['decorators-legacy', 'classProperties', 'classPrivateProperties', 'classPrivateMethods',
        'classStaticBlock', 'dynamicImport', 'importMeta', 'optionalChaining', 'nullishCoalescingOperator',
        'objectRestSpread', 'topLevelAwait', 'numericSeparator', 'logicalAssignment', 'privateIn',
        'exportDefaultFrom', 'exportNamespaceFrom', ...(ext.toLowerCase() === '.tsx' ? ['jsx'] : []), 'typescript'] } });
  return ast;
};
