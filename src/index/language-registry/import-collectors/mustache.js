export const collectMustacheImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/{{>\s*([A-Za-z0-9_.-]+)\b/);
    if (match) imports.push(match[1]);
  }
  return imports;
};
