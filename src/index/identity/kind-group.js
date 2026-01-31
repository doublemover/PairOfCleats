export const toKindGroup = (kind) => {
  const raw = typeof kind === 'string' ? kind.trim() : '';
  if (!raw) return 'other';
  const value = raw.toLowerCase();
  if (value === 'function' || value === 'arrow_function' || value === 'generator') return 'function';
  if (value === 'class') return 'class';
  if (value === 'method' || value === 'constructor') return 'method';
  if (value === 'interface' || value === 'type' || value === 'enum') return 'type';
  if (value === 'variable' || value === 'const' || value === 'let') return 'value';
  if (value === 'module' || value === 'namespace' || value === 'file') return 'module';
  return 'other';
};
