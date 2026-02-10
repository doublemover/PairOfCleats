/**
 * Collect Python import statements and simple usages.
 * @param {string} text
 * @returns {{imports:string[],usages:string[]}}
 */
export function collectPythonImports(text) {
  const compareCaseAware = (a, b) => (
    String(a).toLowerCase().localeCompare(String(b).toLowerCase()) || String(a).localeCompare(String(b))
  );
  const normalizeSpecifier = (value, { allowRelative = false } = {}) => {
    if (!value) return '';
    const trimmed = String(value).trim();
    if (!trimmed) return '';
    const withoutComma = trimmed.replace(/,+$/g, '');
    const modulePart = withoutComma.split(/\s+as\s+/i)[0]?.trim() || '';
    if (!modulePart) return '';
    if (allowRelative && /^\.+[A-Za-z0-9_\.]*$/.test(modulePart)) return modulePart;
    if (/^[A-Za-z_][A-Za-z0-9_\.]*$/.test(modulePart)) return modulePart;
    return '';
  };
  const normalizeUsage = (value) => {
    if (!value) return '';
    const trimmed = String(value).trim().replace(/,+$/g, '');
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) ? trimmed : '';
  };
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
        const [moduleNameRaw, aliasRaw] = part.split(/\s+as\s+/i);
        const moduleName = normalizeSpecifier(moduleNameRaw);
        const alias = normalizeUsage(aliasRaw);
        if (moduleName) imports.add(moduleName);
        if (alias) usages.add(alias);
      }
      continue;
    }
    match = trimmed.match(/^from\s+(\.+[A-Za-z0-9_\.]*|[A-Za-z_][A-Za-z0-9_\.]*)\s+import\s+(.+)$/);
    if (match) {
      const moduleName = normalizeSpecifier(match[1], { allowRelative: true });
      if (moduleName) imports.add(moduleName);
      const names = match[2].split(',').map((p) => p.trim()).filter(Boolean);
      for (const namePart of names) {
        const [nameRaw, aliasRaw] = namePart.split(/\s+as\s+/i);
        const name = normalizeUsage(nameRaw);
        const alias = normalizeUsage(aliasRaw);
        if (name) usages.add(name);
        if (alias) usages.add(alias);
      }
    }
  }
  return {
    imports: Array.from(imports).sort(compareCaseAware),
    usages: Array.from(usages).sort(compareCaseAware)
  };
}
