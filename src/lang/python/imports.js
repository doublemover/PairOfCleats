/**
 * Collect Python import statements and simple usages.
 * @param {string} text
 * @returns {{imports:string[],usages:string[]}}
 */
export function collectPythonImports(text) {
  const imports = new Set();
  const usages = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    let match = trimmed.match(/^import\s+(.+)$/);
    if (match) {
      const parts = match[1].split(',').map((p) => p.trim()).filter(Boolean);
      for (const part of parts) {
        const [moduleName, alias] = part.split(/\s+as\s+/);
        if (moduleName) imports.add(moduleName);
        if (alias) usages.add(alias);
      }
      continue;
    }
    match = trimmed.match(/^from\s+([A-Za-z0-9_\.]+)\s+import\s+(.+)$/);
    if (match) {
      imports.add(match[1]);
      const names = match[2].split(',').map((p) => p.trim()).filter(Boolean);
      for (const namePart of names) {
        const [name, alias] = namePart.split(/\s+as\s+/);
        if (name) usages.add(name);
        if (alias) usages.add(alias);
      }
    }
  }
  return { imports: Array.from(imports), usages: Array.from(usages) };
}
