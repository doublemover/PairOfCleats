import fs from 'node:fs';

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const normalizePack = (pack) => ({
  id: String(pack.id || '').trim(),
  label: pack.label || '',
  engine: pack.engine || '',
  rules: Array.isArray(pack.rules) ? pack.rules : [],
  severity: pack.severity || null,
  tags: Array.isArray(pack.tags) ? pack.tags : [],
  description: pack.description || ''
});

export const loadRegistry = (registryPath) => {
  if (!fs.existsSync(registryPath)) return { packs: [] };
  const registry = readJson(registryPath);
  const packs = Array.isArray(registry.packs) ? registry.packs : [];
  return { packs: packs.map(normalizePack) };
};

export const resolvePacks = (registry, packIds) => {
  const resolvePack = (id) => registry.packs.find((pack) => pack.id === id);
  const selectedPacks = packIds.map(resolvePack).filter(Boolean);
  const missingPacks = packIds.filter((id) => !resolvePack(id));
  return { selectedPacks, missingPacks };
};
