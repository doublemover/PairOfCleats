import { buildLineIndex, offsetToLine } from '../../shared/lines.js';
import { collectAttributes, extractDocComment, sliceSignature } from '../shared.js';
import { findCLikeBodyBounds } from '../clike.js';
import {
  extractTypeScriptInheritance,
  extractTypeScriptModifiers,
  extractTypeScriptParamTypes,
  extractTypeScriptParams,
  extractVisibility,
  parseTypeScriptSignature,
  readSignatureLines
} from './signature.js';

/**
 * Build chunk metadata for TypeScript declarations.
 * Returns null when no declarations are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildTypeScriptChunksHeuristic(text) {
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];
  const typeDecls = [];

  const typeRe = /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(class|interface|enum|type|namespace|module)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
  const funcRe = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/;
  const assignFuncRe = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?function\b/;
  const arrowRe = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?(?:<[^>]+>\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*[^=]+)?=>/;
  const kindMap = {
    class: 'ClassDeclaration',
    interface: 'InterfaceDeclaration',
    enum: 'EnumDeclaration',
    type: 'TypeAliasDeclaration',
    namespace: 'NamespaceDeclaration',
    module: 'NamespaceDeclaration'
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    let match = trimmed.match(typeRe);
    if (match) {
      const kindKey = match[1];
      const start = lineIndex[i] + line.indexOf(match[0]);
      let end = lineIndex[i] + line.length;
      let signature = trimmed;
      if (kindKey !== 'type') {
        const bounds = findCLikeBodyBounds(text, start);
        if (bounds.bodyStart !== -1) {
          end = bounds.bodyEnd > start ? bounds.bodyEnd : bounds.bodyStart;
          signature = sliceSignature(text, start, bounds.bodyStart);
        }
      }
      const modifiers = extractTypeScriptModifiers(signature);
      const { extendsList, implementsList } = extractTypeScriptInheritance(signature);
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, Math.max(start, end - 1)),
        signature,
        modifiers,
        visibility: extractVisibility(modifiers),
        docstring: extractDocComment(lines, i),
        attributes: collectAttributes(lines, i, signature),
        extends: extendsList,
        implements: implementsList
      };
      const entry = { start, end, name: match[2], kind: kindMap[kindKey] || 'ClassDeclaration', meta };
      decls.push(entry);
      if (kindKey === 'class' || kindKey === 'interface' || kindKey === 'enum') {
        typeDecls.push(entry);
      }
      continue;
    }
    match = trimmed.match(funcRe);
    if (match) {
      const start = lineIndex[i] + line.indexOf(match[0]);
      const { signature, endLine, hasBody } = readSignatureLines(lines, i);
      const bounds = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
      const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[endLine] + lines[endLine].length;
      const modifiers = extractTypeScriptModifiers(signature);
      const parsed = parseTypeScriptSignature(signature);
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, Math.max(start, end - 1)),
        signature,
        params: extractTypeScriptParams(signature),
        paramTypes: extractTypeScriptParamTypes(signature),
        returns: parsed.returns,
        modifiers,
        visibility: extractVisibility(modifiers),
        docstring: extractDocComment(lines, i),
        attributes: collectAttributes(lines, i, signature)
      };
      decls.push({ start, end, name: parsed.name || match[1], kind: 'FunctionDeclaration', meta });
    }

    match = trimmed.match(assignFuncRe);
    if (match) {
      const start = lineIndex[i] + line.indexOf(match[0]);
      const { signature, endLine, hasBody } = readSignatureLines(lines, i);
      const bounds = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
      const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[endLine] + lines[endLine].length;
      const modifiers = extractTypeScriptModifiers(signature);
      const parsed = parseTypeScriptSignature(signature);
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, Math.max(start, end - 1)),
        signature,
        params: extractTypeScriptParams(signature),
        paramTypes: extractTypeScriptParamTypes(signature),
        returns: parsed.returns,
        modifiers,
        visibility: extractVisibility(modifiers),
        docstring: extractDocComment(lines, i),
        attributes: collectAttributes(lines, i, signature)
      };
      decls.push({ start, end, name: parsed.name || match[1], kind: 'FunctionDeclaration', meta });
      continue;
    }

    match = trimmed.match(arrowRe);
    if (match) {
      const start = lineIndex[i] + line.indexOf(match[0]);
      const { signature, endLine, hasBody } = readSignatureLines(lines, i);
      const bounds = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
      const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[endLine] + lines[endLine].length;
      const modifiers = extractTypeScriptModifiers(signature);
      const parsed = parseTypeScriptSignature(signature);
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, Math.max(start, end - 1)),
        signature,
        params: extractTypeScriptParams(signature),
        paramTypes: extractTypeScriptParamTypes(signature),
        returns: parsed.returns,
        modifiers,
        visibility: extractVisibility(modifiers),
        docstring: extractDocComment(lines, i),
        attributes: collectAttributes(lines, i, signature)
      };
      decls.push({ start, end, name: parsed.name || match[1], kind: 'FunctionDeclaration', meta });
      continue;
    }
  }

  const methodRe = /^\s*(?:public|private|protected|static|abstract|async|readonly|override|declare\s+)*(?:get|set\s+)?([A-Za-z_$][A-Za-z0-9_$]*|constructor)\s*(?:<[^>]+>)?\s*\(/;
  for (const typeDecl of typeDecls) {
    if (!typeDecl || typeDecl.start == null || typeDecl.end == null) continue;
    const bounds = findCLikeBodyBounds(text, typeDecl.start);
    if (bounds.bodyStart === -1 || bounds.bodyEnd === -1) continue;
    const startLine = offsetToLine(lineIndex, bounds.bodyStart + 1);
    const endLine = offsetToLine(lineIndex, bounds.bodyEnd);
    for (let i = startLine - 1; i < Math.min(lines.length, endLine); i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
      const match = trimmed.match(methodRe);
      if (!match) continue;
      const start = lineIndex[i] + line.indexOf(match[0]);
      const { signature, endLine: sigEndLine, hasBody } = readSignatureLines(lines, i);
      const boundsInner = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
      const end = boundsInner.bodyEnd > start ? boundsInner.bodyEnd : lineIndex[sigEndLine] + lines[sigEndLine].length;
      const parsed = parseTypeScriptSignature(signature);
      const methodName = parsed.name || match[1] || 'anonymous';
      const modifiers = extractTypeScriptModifiers(signature);
      const meta = {
        startLine: i + 1,
        endLine: offsetToLine(lineIndex, Math.max(start, end - 1)),
        signature,
        params: extractTypeScriptParams(signature),
        paramTypes: extractTypeScriptParamTypes(signature),
        returns: parsed.returns,
        modifiers,
        visibility: extractVisibility(modifiers),
        docstring: extractDocComment(lines, i),
        attributes: collectAttributes(lines, i, signature)
      };
      decls.push({
        start,
        end,
        name: `${typeDecl.name}.${methodName}`,
        kind: methodName === 'constructor' ? 'ConstructorDeclaration' : 'MethodDeclaration',
        meta
      });
    }
  }

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
