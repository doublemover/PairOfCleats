export const collectRImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/\b(?:library|require)\s*\(\s*['"]?([^'"]+)['"]?\s*\)/);
    if (match) imports.push(match[1]);
  }
  return imports;
};
