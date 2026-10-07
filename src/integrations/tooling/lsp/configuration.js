const MAX_CONFIGURATION_ITEMS = 64;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const readSection = (settings, section) => {
  if (section == null || section === '') return settings;
  if (typeof section !== 'string') return null;
  const keys = section.split('.');
  if (keys.some((key) => !key || FORBIDDEN_KEYS.has(key))) return null;
  if (Object.hasOwn(settings, section)) return settings[section] ?? null;
  let value = settings;
  for (const key of keys) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return null;
    value = value[key];
  }
  return value ?? null;
};

/**
 * Serve only explicitly configured settings, never workspace files or server-
 * supplied scope URIs. The same initialization options identify a pooled session.
 * @param {object|null} initializationOptions
 * @returns {((message:object)=>Promise<any>)|null}
 */
export const createLspConfigurationHandler = (initializationOptions) => {
  const settings = initializationOptions?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  return async (message) => {
    if (message?.method !== 'workspace/configuration') return null;
    const items = message.params?.items;
    if (!Array.isArray(items)) return [];
    if (items.length > MAX_CONFIGURATION_ITEMS) {
      const error = new Error('LSP configuration item limit exceeded.');
      error.code = -32602;
      throw error;
    }
    return items.map((item) => readSection(settings, item?.section));
  };
};
