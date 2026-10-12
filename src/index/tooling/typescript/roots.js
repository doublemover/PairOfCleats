import path from 'node:path';

/** The same source-to-VFS identity is used for roots and resolved imports. */
export const createTypeScriptVirtualBySource = (sourcePaths, canonicalize) => {
  const virtualBySource = new Map();
  for (const [virtualPath, sourcePath] of sourcePaths) {
    virtualBySource.set(canonicalize(sourcePath), virtualPath);
  }
  return virtualBySource;
};

/**
 * Replace whole-file source roots with their authoritative VFS identities before
 * constructing a Program. A physical root and its virtual twin are one source,
 * not two independent declarations. Unmapped roots (including ambient sources)
 * stay in their original positions. Embedded segments have no sourcePaths alias
 * and must not replace their containers. Only aliases from this config group
 * participate; referenced projects retain their own configuration and roots.
 */
export const createTypeScriptRootNames = ({
  configRootNames = [], virtualRootNames = [], sourcePaths = new Map(), useCaseSensitive = process.platform !== 'win32'
}) => {
  const canonicalize = value => {
    const resolved = path.resolve(value);
    return useCaseSensitive ? resolved : resolved.toLowerCase();
  };
  const aliases = createTypeScriptVirtualBySource(sourcePaths, canonicalize);
  const virtualNames = new Map();
  for (const root of virtualRootNames) {
    const key = canonicalize(root);
    if (!virtualNames.has(key)) virtualNames.set(key, root);
  }
  const seen = new Set(), roots = [];
  for (const candidate of [...configRootNames, ...virtualRootNames]) {
    const alias = aliases.get(canonicalize(candidate));
    const root = alias ? virtualNames.get(canonicalize(alias)) || alias : candidate;
    const key = canonicalize(root);
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(root);
  }
  return roots;
};
