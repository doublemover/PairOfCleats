export const collectJuliaImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*(?:using|import)\s+([A-Za-z0-9_.:]+)/);
    if (match) imports.push(match[1]);
  }
  return imports;
};
