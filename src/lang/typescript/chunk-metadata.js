import { buildLineIndex, offsetToLine } from '../../shared/lines.js';
import { collectAttributes, extractDocComment, sliceSignature } from '../shared.js';
import {
  extractTypeScriptModifiers,
  extractVisibility
} from './signature.js';

export const qualifyTypeScriptChunkName = (prefix, name) => (
  prefix ? `${prefix}.${name}` : name
);

export const createTypeScriptChunkMetadataContext = (text) => {
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');

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

  return {
    buildSignature,
    buildMetaBase
  };
};

export const finalizeTypeScriptChunkDeclarations = (decls) => {
  if (!decls.length) return null;
  decls.sort((a, b) => a.start - b.start);
  return decls.map((decl) => ({
    start: decl.start,
    end: decl.end,
    name: decl.name,
    kind: decl.kind,
    meta: decl.meta || {}
  }));
};

export const createTypeScriptChunkDeclarationSink = (text) => {
  const decls = [];
  const metadataContext = createTypeScriptChunkMetadataContext(text);
  return {
    ...metadataContext,
    addDeclaration({ start, end, name, kind, meta }) {
      if (!name) return;
      decls.push({ start, end, name, kind, meta });
    },
    finish() {
      return finalizeTypeScriptChunkDeclarations(decls);
    }
  };
};
