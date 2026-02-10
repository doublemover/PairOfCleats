import { parseBabelAst } from '../babel-parser.js';
import { buildLineIndex, offsetToLine } from '../../shared/lines.js';
import { collectAttributes, extractDocComment, sliceSignature } from '../shared.js';
import {
  extractTypeScriptInheritance,
  extractTypeScriptModifiers,
  extractTypeScriptParamTypes,
  extractTypeScriptParams,
  extractTypeScriptReturns,
  extractVisibility,
  parseTypeScriptSignature
} from './signature.js';

function getBabelName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral') return String(node.value);
  if (node.type === 'PrivateName' && node.id?.name) return `#${node.id.name}`;
  if (node.type === 'TSQualifiedName') {
    const left = getBabelName(node.left);
    const right = getBabelName(node.right);
    if (left && right) return `${left}.${right}`;
  }
  return null;
}

export function buildTypeScriptChunksFromBabel(text, options = {}) {
  const ast = parseBabelAst(text, { ext: options.ext || '', mode: 'typescript' });
  if (!ast || !Array.isArray(ast.body)) return null;
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];

  const qualify = (prefix, name) => (prefix ? `${prefix}.${name}` : name);
  const buildSignature = (start, bodyStart) => sliceSignature(text, start, bodyStart);
  const buildMetaBase = (start, end, signature) => {
    const startLine = offsetToLine(lineIndex, start);
    const endLine = offsetToLine(lineIndex, Math.max(start, end - 1));
    const modifiers = extractTypeScriptModifiers(signature);
    return {
      startLine,
      endLine,
      signature,
      modifiers,
      visibility: extractVisibility(modifiers),
      docstring: extractDocComment(lines, startLine - 1),
      attributes: collectAttributes(lines, startLine - 1, signature)
    };
  };
  const buildFunctionMeta = (start, end, signature) => ({
    ...buildMetaBase(start, end, signature),
    params: extractTypeScriptParams(signature),
    paramTypes: extractTypeScriptParamTypes(signature),
    returns: extractTypeScriptReturns(signature)
  });
  const buildTypeMeta = (start, end, signature) => {
    const base = buildMetaBase(start, end, signature);
    const { extendsList, implementsList } = extractTypeScriptInheritance(signature);
    return { ...base, extends: extendsList, implements: implementsList };
  };
  const addChunk = (node, name, kind, meta) => {
    if (!node || !name) return;
    const start = Number.isFinite(node.start) ? node.start : 0;
    const end = Number.isFinite(node.end) ? node.end : start;
    decls.push({ start, end, name, kind, meta });
  };

  const handleClassMembers = (prefix, className, members) => {
    const qualified = qualify(prefix, className);
    for (const member of members || []) {
      if (member.type === 'ClassMethod' || member.type === 'ClassPrivateMethod') {
        const methodName = getBabelName(member.key) || 'anonymous';
        const signature = buildSignature(member.start, member.body?.start ?? -1);
        addChunk(member, `${qualified}.${methodName}`, 'MethodDeclaration',
          buildFunctionMeta(member.start, member.end, signature));
      }
      if ((member.type === 'ClassProperty' || member.type === 'ClassPrivateProperty')
        && member.value && (member.value.type === 'ArrowFunctionExpression'
          || member.value.type === 'FunctionExpression')) {
        const propName = getBabelName(member.key) || 'anonymous';
        const bodyStart = member.value.body?.start ?? -1;
        const signature = buildSignature(member.start, bodyStart);
        addChunk(member, `${qualified}.${propName}`, 'MethodDeclaration',
          buildFunctionMeta(member.start, member.end, signature));
      }
    }
  };

  const handleStatement = (stmt, prefix = '') => {
    if (!stmt) return;
    if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
      if (stmt.declaration) {
        handleStatement(stmt.declaration, prefix);
      }
      return;
    }
    if (stmt.type === 'ClassDeclaration' && stmt.id?.name) {
      const start = stmt.start ?? 0;
      const signature = buildSignature(start, stmt.body?.start ?? -1);
      addChunk(stmt, qualify(prefix, stmt.id.name), 'ClassDeclaration',
        buildTypeMeta(start, stmt.end ?? start, signature));
      handleClassMembers(prefix, stmt.id.name, stmt.body?.body || []);
      return;
    }
    if (stmt.type === 'TSInterfaceDeclaration' && stmt.id?.name) {
      const start = stmt.start ?? 0;
      const signature = buildSignature(start, stmt.body?.start ?? -1);
      addChunk(stmt, qualify(prefix, stmt.id.name), 'InterfaceDeclaration',
        buildTypeMeta(start, stmt.end ?? start, signature));
      return;
    }
    if (stmt.type === 'TSEnumDeclaration' && stmt.id?.name) {
      const start = stmt.start ?? 0;
      const signature = buildSignature(start, stmt.members?.[0]?.start ?? -1);
      addChunk(stmt, qualify(prefix, stmt.id.name), 'EnumDeclaration',
        buildMetaBase(start, stmt.end ?? start, signature));
      return;
    }
    if (stmt.type === 'TSTypeAliasDeclaration' && stmt.id?.name) {
      const start = stmt.start ?? 0;
      const signature = buildSignature(start, -1);
      addChunk(stmt, qualify(prefix, stmt.id.name), 'TypeAliasDeclaration',
        buildMetaBase(start, stmt.end ?? start, signature));
      return;
    }
    if (stmt.type === 'TSModuleDeclaration' && stmt.id) {
      const name = getBabelName(stmt.id);
      if (!name) return;
      const start = stmt.start ?? 0;
      const signature = buildSignature(start, stmt.body?.start ?? -1);
      addChunk(stmt, qualify(prefix, name), 'NamespaceDeclaration',
        buildMetaBase(start, stmt.end ?? start, signature));
      const moduleBody = stmt.body?.body;
      if (Array.isArray(moduleBody)) {
        moduleBody.forEach((child) => handleStatement(child, qualify(prefix, name)));
      } else if (stmt.body) {
        handleStatement(stmt.body, qualify(prefix, name));
      }
      return;
    }
    if (stmt.type === 'TSDeclareFunction' && stmt.id?.name) {
      const start = stmt.start ?? 0;
      const signature = buildSignature(start, -1);
      addChunk(stmt, qualify(prefix, stmt.id.name), 'FunctionDeclaration',
        buildFunctionMeta(start, stmt.end ?? start, signature));
      return;
    }
    if (stmt.type === 'FunctionDeclaration' && stmt.id?.name) {
      const start = stmt.start ?? 0;
      const signature = buildSignature(start, stmt.body?.start ?? -1);
      addChunk(stmt, qualify(prefix, stmt.id.name), 'FunctionDeclaration',
        buildFunctionMeta(start, stmt.end ?? start, signature));
      return;
    }
    if (stmt.type === 'VariableDeclaration') {
      for (const decl of stmt.declarations || []) {
        if (decl.id?.name && decl.init
          && (decl.init.type === 'FunctionExpression' || decl.init.type === 'ArrowFunctionExpression')) {
          const start = decl.start ?? stmt.start ?? 0;
          const signature = buildSignature(start, decl.init.body?.start ?? -1);
          addChunk(decl, qualify(prefix, decl.id.name), 'FunctionDeclaration',
            buildFunctionMeta(start, decl.end ?? start, signature));
        }
      }
    }
  };

  ast.body.forEach((stmt) => handleStatement(stmt, ''));
  if (!decls.length) return null;
  decls.sort((a, b) => a.start - b.start);
  return decls.map((decl) => ({
    start: decl.start,
    end: decl.end,
    name: decl.name,
    kind: decl.kind,
    meta: decl.meta || {}
  }));
}
