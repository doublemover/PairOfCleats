import { buildLineIndex, offsetToLine } from '../../shared/lines.js';
import { collectAttributes, extractDocComment, sliceSignature } from '../shared.js';
import { findCLikeBodyBounds } from '../clike.js';
import {
  extractTypeScriptModifiers,
  extractTypeScriptParamTypes,
  extractTypeScriptParams,
  extractTypeScriptReturns,
  extractVisibility,
  mergeParamTypes
} from './signature.js';
import { isLikelyTsx, loadTypeScriptModule, resolveTypeScriptFilename } from './parser.js';

function getTypeScriptName(ts, node, sourceFile) {
  if (!node) return null;
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPrivateIdentifier(node)) return `#${node.text}`;
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  if (typeof node.getText === 'function') {
    const raw = node.getText(sourceFile);
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(raw)) return raw;
  }
  return null;
}

function extractTypeScriptHeritage(ts, node, sourceFile) {
  const extendsList = [];
  const implementsList = [];
  for (const clause of node?.heritageClauses || []) {
    let target = null;
    if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
      target = extendsList;
    } else if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
      target = implementsList;
    }
    if (!target || !Array.isArray(clause?.types) || !clause.types.length) continue;
    for (const entry of clause.types) {
      const value = entry?.getText ? entry.getText(sourceFile).trim() : '';
      if (value) target.push(value);
    }
  }
  return { extendsList, implementsList };
}

function collectParamDetails(ts, node, sourceFile, signature) {
  const params = [];
  const seen = new Set();
  const paramTypes = {};
  for (const param of node?.parameters || []) {
    if (!param?.name || !ts.isIdentifier(param.name)) continue;
    const name = param.name.text;
    if (!name) continue;
    if (!seen.has(name)) {
      params.push(name);
      seen.add(name);
    }
    const typeText = param.type ? param.type.getText(sourceFile).trim() : '';
    if (typeText) paramTypes[name] = typeText;
  }
  const fallbackParams = extractTypeScriptParams(signature);
  const fallbackTypes = extractTypeScriptParamTypes(signature);
  for (const name of fallbackParams) {
    if (!seen.has(name)) {
      params.push(name);
      seen.add(name);
    }
  }
  return {
    params: params.length ? params : fallbackParams,
    paramTypes: mergeParamTypes(paramTypes, fallbackTypes)
  };
}

export function buildTypeScriptChunksFromAst(text, options = {}) {
  const ts = loadTypeScriptModule(options.rootDir);
  if (!ts) return null;
  const ext = options.ext || '';
  const tsx = isLikelyTsx(text, ext);
  const fileName = resolveTypeScriptFilename(ext, tsx);
  let sourceFile;
  try {
    sourceFile = ts.createSourceFile(
      fileName,
      text,
      ts.ScriptTarget.Latest,
      true,
      tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
  } catch {
    return null;
  }
  if (!sourceFile) return null;

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

  const buildFunctionMeta = (node, signature, start, end) => {
    const base = buildMetaBase(start, end, signature);
    const { params, paramTypes } = collectParamDetails(ts, node, sourceFile, signature);
    const returns = ts.isConstructorDeclaration(node)
      ? null
      : (node?.type ? node.type.getText(sourceFile).trim() : extractTypeScriptReturns(signature));
    return { ...base, params, paramTypes, returns };
  };

  const buildTypeMeta = (node, signature, start, end) => {
    const base = buildMetaBase(start, end, signature);
    const { extendsList, implementsList } = extractTypeScriptHeritage(ts, node, sourceFile);
    return { ...base, extends: extendsList, implements: implementsList };
  };

  const addChunk = (start, end, name, kind, meta) => {
    if (!name) return;
    decls.push({ start, end, name, kind, meta });
  };

  const isFunctionInitializer = (node) => ts.isArrowFunction(node) || ts.isFunctionExpression(node);

  const handleClassMembers = (prefix, className, members) => {
    const qualified = qualify(prefix, className);
    for (const member of members || []) {
      if (ts.isConstructorDeclaration(member)) {
        const start = member.getStart(sourceFile);
        const end = member.end;
        const bodyStart = member.body ? member.body.getStart(sourceFile) : -1;
        const signature = buildSignature(start, bodyStart);
        addChunk(start, end, `${qualified}.constructor`, 'ConstructorDeclaration',
          buildFunctionMeta(member, signature, start, end));
        continue;
      }
      if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) {
        const methodName = getTypeScriptName(ts, member.name, sourceFile);
        if (!methodName) continue;
        const start = member.getStart(sourceFile);
        const end = member.end;
        const bodyStart = member.body ? member.body.getStart(sourceFile) : -1;
        const signature = buildSignature(start, bodyStart);
        addChunk(start, end, `${qualified}.${methodName}`, 'MethodDeclaration',
          buildFunctionMeta(member, signature, start, end));
        continue;
      }
      if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
        const accessorName = getTypeScriptName(ts, member.name, sourceFile);
        if (!accessorName) continue;
        const start = member.getStart(sourceFile);
        const end = member.end;
        const bodyStart = member.body ? member.body.getStart(sourceFile) : -1;
        const signature = buildSignature(start, bodyStart);
        addChunk(start, end, `${qualified}.${accessorName}`, 'MethodDeclaration',
          buildFunctionMeta(member, signature, start, end));
        continue;
      }
      if (ts.isPropertyDeclaration(member) && member.name && member.initializer
        && isFunctionInitializer(member.initializer)) {
        const propName = getTypeScriptName(ts, member.name, sourceFile);
        if (!propName) continue;
        const start = member.getStart(sourceFile);
        const end = member.end;
        const bodyStart = member.initializer.body ? member.initializer.body.getStart(sourceFile) : -1;
        const signature = buildSignature(start, bodyStart);
        addChunk(start, end, `${qualified}.${propName}`, 'MethodDeclaration',
          buildFunctionMeta(member.initializer, signature, start, end));
      }
    }
  };

  const handleStatements = (statements, prefix = '') => {
    for (const stmt of statements || []) {
      if (ts.isClassDeclaration(stmt) && stmt.name) {
        const name = getTypeScriptName(ts, stmt.name, sourceFile);
        if (!name) continue;
        const start = stmt.getStart(sourceFile);
        const end = stmt.end;
        const bounds = findCLikeBodyBounds(text, start);
        const signature = buildSignature(start, bounds.bodyStart);
        addChunk(start, end, qualify(prefix, name), 'ClassDeclaration',
          buildTypeMeta(stmt, signature, start, end));
        handleClassMembers(prefix, name, stmt.members);
        continue;
      }
      if (ts.isInterfaceDeclaration(stmt) && stmt.name) {
        const name = getTypeScriptName(ts, stmt.name, sourceFile);
        if (!name) continue;
        const start = stmt.getStart(sourceFile);
        const end = stmt.end;
        const bounds = findCLikeBodyBounds(text, start);
        const signature = buildSignature(start, bounds.bodyStart);
        addChunk(start, end, qualify(prefix, name), 'InterfaceDeclaration',
          buildTypeMeta(stmt, signature, start, end));
        handleClassMembers(prefix, name, stmt.members);
        continue;
      }
      if (ts.isEnumDeclaration(stmt) && stmt.name) {
        const name = getTypeScriptName(ts, stmt.name, sourceFile);
        if (!name) continue;
        const start = stmt.getStart(sourceFile);
        const end = stmt.end;
        const bounds = findCLikeBodyBounds(text, start);
        const signature = buildSignature(start, bounds.bodyStart);
        addChunk(start, end, qualify(prefix, name), 'EnumDeclaration',
          buildMetaBase(start, end, signature));
        continue;
      }
      if (ts.isTypeAliasDeclaration(stmt) && stmt.name) {
        const name = getTypeScriptName(ts, stmt.name, sourceFile);
        if (!name) continue;
        const start = stmt.getStart(sourceFile);
        const end = stmt.end;
        const signature = buildSignature(start, -1);
        addChunk(start, end, qualify(prefix, name), 'TypeAliasDeclaration',
          buildMetaBase(start, end, signature));
        continue;
      }
      if (ts.isFunctionDeclaration(stmt) && stmt.name) {
        const name = getTypeScriptName(ts, stmt.name, sourceFile);
        if (!name) continue;
        const start = stmt.getStart(sourceFile);
        const end = stmt.end;
        const bodyStart = stmt.body ? stmt.body.getStart(sourceFile) : -1;
        const signature = buildSignature(start, bodyStart);
        addChunk(start, end, qualify(prefix, name), 'FunctionDeclaration',
          buildFunctionMeta(stmt, signature, start, end));
        continue;
      }
      if (ts.isVariableStatement(stmt)) {
        const declarations = stmt.declarationList?.declarations || [];
        const useStatementStart = declarations.length === 1;
        for (const decl of declarations) {
          if (!decl?.name || !decl.initializer || !ts.isIdentifier(decl.name)) continue;
          if (!isFunctionInitializer(decl.initializer)) continue;
          const name = decl.name.text;
          const start = useStatementStart ? stmt.getStart(sourceFile) : decl.getStart(sourceFile);
          const end = decl.initializer.end;
          const bodyStart = decl.initializer.body ? decl.initializer.body.getStart(sourceFile) : -1;
          const signature = buildSignature(start, bodyStart);
          addChunk(start, end, qualify(prefix, name), 'FunctionDeclaration',
            buildFunctionMeta(decl.initializer, signature, start, end));
        }
        continue;
      }
      if (ts.isModuleDeclaration(stmt) && stmt.name) {
        const name = getTypeScriptName(ts, stmt.name, sourceFile);
        if (!name) continue;
        const start = stmt.getStart(sourceFile);
        const end = stmt.end;
        const bounds = findCLikeBodyBounds(text, start);
        const signature = buildSignature(start, bounds.bodyStart);
        addChunk(start, end, qualify(prefix, name), 'NamespaceDeclaration',
          buildMetaBase(start, end, signature));
        if (stmt.body) {
          if (ts.isModuleBlock(stmt.body)) {
            handleStatements(stmt.body.statements, qualify(prefix, name));
          } else if (ts.isModuleDeclaration(stmt.body)) {
            handleStatements([stmt.body], qualify(prefix, name));
          }
        }
      }
    }
  };

  handleStatements(sourceFile.statements, '');

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
