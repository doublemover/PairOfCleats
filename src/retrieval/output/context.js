export function cleanContext(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((line) => typeof line === 'string')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed.startsWith('```')) return false;
      if (!/[a-zA-Z0-9]/.test(trimmed)) return false;
      return true;
    })
    .map((line) => line.replace(/\s+/g, ' ').trim());
}
