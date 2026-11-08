import { COMMON_NAME_NODE_TYPES, getNamedChild, getNamedChildCount } from '../ast.js';
import { isNativeProjectionBudgetFailure } from './projection-work.js';
import { isAbortError } from '../../../shared/abort.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';

// Positive semantic type/container policy; lexical modules, namespaces, packages,
// schemas, document elements and configuration keys do not acquire method roles.
const semanticTypeKinds = new Set(['ClassDeclaration', 'StructDeclaration', 'InterfaceDeclaration',
  'TraitDeclaration', 'EnumDeclaration', 'ObjectDeclaration', 'RecordDeclaration', 'AnnotationDeclaration',
  'ProtocolDeclaration', 'ExtensionDeclaration', 'ActorDeclaration', 'MixinDeclaration', 'ImplDeclaration', 'GivenDeclaration']);
export const isNativeSemanticTypeKind = kind => semanticTypeKinds.has(kind);
const nameSource = (node, text) => node && Number.isFinite(node.startIndex) && Number.isFinite(node.endIndex)
  && node.startIndex >= 0 && node.endIndex > node.startIndex && node.startIndex <= text.length
  ? text.slice(node.startIndex, Math.min(node.endIndex, text.length)).trim() : '';
const forward = error => {
  if (isNativeProjectionBudgetFailure(error) || isAbortError(error)) throw error;
  observeStorageResource(error, { phase: 'native-projection-name' }).requireSettled();
};

/** Private context survives only this native tree's synchronous projection.
 * Memoized names and persistent parent links prevent per-chunk ancestor rescans.
 */
export const createNativeProjectionNames = ({ text, config, work }) => {
  const names = new Map(), contexts = new Map(), siblingScopes = new Map();
  const key = node => `${node.type}:${node.startIndex}:${node.endIndex}:${node.id ?? ''}`;
  const findName = node => {
    const types = config?.nameTypes?.size ? config.nameTypes : COMMON_NAME_NODE_TYPES;
    const maxDepth = Number.isFinite(config.nameSearchMaxDepth) ? Math.max(1, Math.floor(config.nameSearchMaxDepth)) : 6;
    const maxNodes = Number.isFinite(config.nameSearchMaxNodes) ? Math.max(1, Math.floor(config.nameSearchMaxNodes)) : 128;
    let frontier = [], visited = 0;
    const append = (parent, target) => {
      const count = getNamedChildCount(parent);
      if (count > maxNodes - visited - target.length) work.fail('nameSearchMaxNodes');
      for (let index = 0; index < count; index++) { const child = getNamedChild(parent, index); if (child) target.push(child); }
    };
    append(node, frontier);
    for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
      const next = [];
      for (let index = 0; index < frontier.length; index++) {
        const candidate = frontier[index]; if (!candidate) continue; visited++;
        if (types.has(candidate.type)) return candidate;
      }
      // Preserve BFS precedence: finish the current level before expanding any
      // next-level wrapper. A later shallow identifier wins without allocating
      // an unused wide subtree of an earlier non-name sibling.
      for (const parent of frontier) {
        if (depth === maxDepth) { if (getNamedChildCount(parent)) work.fail('nameSearchMaxDepth'); }
        else append(parent, next);
      }
      frontier = next;
    }
    return null;
  };
  const name = value => work.project(() => {
    const node = work.view(value); if (!node) return '';
    const identity = key(node);
    if (names.has(identity)) { work.hit('nameCacheHits'); return names.get(identity); }
    let result = '';
    if (typeof config.resolveName === 'function') {
      try { const resolved = config.resolveName(node, text); result = typeof resolved === 'string' ? resolved.trim() : resolved?.name?.trim() || ''; }
      catch (error) { forward(error); }
    }
    if (!result) for (const field of Array.isArray(config.nameFields) ? config.nameFields : []) {
      if (typeof field !== 'string' || !field || typeof node.childForFieldName !== 'function') continue;
      try { result = nameSource(node.childForFieldName(field), text); } catch (error) { forward(error); }
      if (result) break;
    }
    if (!result) result = nameSource(findName(node), text);
    names.set(identity, result); return result;
  });
  // PHP's unbraced namespace is a preceding program sibling, not an AST
  // ancestor. Index that grammar-owned state once per program so declarations
  // retain namespace ownership without repeated backward sibling scans.
  const siblingScope = current => {
    const policy = config.siblingScope;
    if (!policy) return undefined;
    const parent = current.parent;
    if (parent?.type !== policy.parentType) return undefined;
    const identity = key(parent);
    if (!siblingScopes.has(identity)) {
      const before = new Map();
      let active = null;
      const count = getNamedChildCount(parent);
      for (let index = 0; index < count; index++) {
        const child = getNamedChild(parent, index);
        if (!child) continue;
        if (child.type === policy.type) {
          // A namespace declaration cannot itself inherit the previous name;
          // braced namespaces own only their body and end sibling ownership.
          before.set(key(child), null);
          const resolved = name(child);
          active = !child.childForFieldName(policy.bodyField) && resolved
            ? { scope: { node: child, name: resolved, kind: config.kindMap[child.type], member: false }, parent: null }
            : null;
        } else before.set(key(child), active);
      }
      siblingScopes.set(identity, before);
    }
    return siblingScopes.get(identity).get(key(current));
  };
  const chain = value => {
    let node = work.view(value); const pending = [];
    try {
      while (node && !contexts.has(key(node))) { work.reserve(1); pending.push(node); node = node.parent; }
      if (node) work.hit('scopeCacheHits');
      let context = node ? contexts.get(key(node)) : null;
      while (pending.length) {
        const current = pending.pop(); work.release(1);
        const preceding = siblingScope(current);
        if (preceding !== undefined) context = preceding;
        if ((config.typeNodes.has(current.type) || config.memberNodes.has(current.type)) && (!config.includeNode || config.includeNode(current))) {
          const resolved = name(current);
          if (resolved) {
            const initial = config.kindMap[current.type] || 'Declaration';
            context = { scope: { node: current, name: resolved, kind: config.resolveKind?.(current, initial, text) || initial,
              member: config.memberNodes.has(current.type) }, parent: context };
          }
        }
        contexts.set(key(current), context);
      }
      return context;
    } finally { if (pending.length) work.release(pending.length); }
  };
  const scopes = value => {
    const node = work.view(value), preceding = siblingScope(node);
    const result = [];
    for (let context = preceding === undefined ? chain(node.parent) : preceding; context; context = context.parent) {
      work.spend('scopeLinks'); result.push(context.scope);
    }
    return result;
  };
  return Object.freeze({ name, scopes });
};
