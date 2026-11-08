import fs from 'node:fs';
import path from 'node:path';

// This deliberately supports the repository's static import/re-export forms,
// not dynamic operational imports. The copied process must link with no npm
// packages installed; any new bare dependency is a fixture admission failure.
const staticImport = /^\s*(?:import\s+(?:(?:[\w$]+\s*,\s*)?(?:\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+)\s+from\s+)?|export\s+(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)\s+from\s+)['"]([^'"]+)['"]/gm;

export const copyBootstrapMetadataSources = (sourceRoot, targetRoot, entries) => {
  const pending = [...entries], seen = new Set();
  while (pending.length) {
    const relative = pending.pop();
    if (seen.has(relative)) continue;
    if (seen.size >= 256) throw new Error('Bootstrap metadata source closure exceeds its fixture bound.');
    seen.add(relative);
    const source = path.resolve(sourceRoot, relative), target = path.resolve(targetRoot, relative);
    if (path.relative(sourceRoot, source).startsWith('..') || path.relative(targetRoot, target).startsWith('..')) throw new Error('Metadata source escaped its fixture root.');
    const text = fs.readFileSync(source, 'utf8');
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text);
    if (!relative.endsWith('.js')) continue;
    for (const [, specifier] of text.matchAll(staticImport)) {
      if (specifier.startsWith('node:')) continue;
      if (!specifier.startsWith('.')) throw new Error('Bootstrap metadata statically links an npm dependency: ' + specifier);
      pending.push(path.relative(sourceRoot, path.resolve(path.dirname(source), specifier)));
    }
  }
  return seen;
};
