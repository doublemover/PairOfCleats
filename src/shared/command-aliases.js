import { describeCommandRegistryEntry } from './command-registry.js';

const PACKAGE_SCRIPT_REPLACEMENT_ENTRIES = Object.freeze([]);

export const PACKAGE_SCRIPT_REPLACEMENTS = Object.freeze(
  Object.fromEntries(PACKAGE_SCRIPT_REPLACEMENT_ENTRIES.map((entry) => [entry.name, entry.replacement]))
);

export const listPackageScriptReplacements = () => PACKAGE_SCRIPT_REPLACEMENT_ENTRIES
  .slice()
  .sort((left, right) => left.name.localeCompare(right.name))
  .map((entry) => ({ ...entry }));

export const getPackageScriptReplacement = (name) => {
  const normalized = String(name || '').trim();
  if (!normalized) return null;
  return PACKAGE_SCRIPT_REPLACEMENTS[normalized] || null;
};

export const describePackageScriptReplacementCommand = (replacement) => {
  const text = String(replacement || '').trim();
  if (!text.startsWith('pairofcleats ')) return null;
  const tokens = text.slice('pairofcleats '.length).trim().split(/\s+/).filter(Boolean);
  for (let length = tokens.length; length > 0; length -= 1) {
    const candidate = describeCommandRegistryEntry(tokens.slice(0, length).join(' '));
    if (candidate) {
      return {
        entry: candidate,
        extraArgs: tokens.slice(length)
      };
    }
  }
  return null;
};
