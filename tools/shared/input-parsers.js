/**
 * Parse key=value metadata arguments.
 * @param {string|string[]|undefined|null} metaArg
 * @returns {Record<string,string>}
 */
export function parseMetaArgs(metaArg) {
  const entries = Array.isArray(metaArg) ? metaArg : (metaArg ? [metaArg] : []);
  const meta = {};
  for (const entry of entries) {
    const [rawKey, ...rest] = String(entry).split('=');
    const key = rawKey.trim();
    if (!key) continue;
    meta[key] = rest.join('=').trim();
  }
  return meta;
}

/**
 * Parse name=url entries into download source objects.
 * @param {string|string[]|undefined|null} input
 * @param {{
 *   fileNameFromName:(name:string)=>string,
 *   hashes?:Record<string,string>|null
 * }} options
 * @returns {Array<{name:string,url:string,file:string,sha256:string|null}>}
 */
export function parseNameUrlSources(input, options) {
  if (!input) return [];
  const items = Array.isArray(input) ? input : [input];
  const hashes = options?.hashes || null;
  const fileNameFromName = options?.fileNameFromName;
  const sources = [];
  if (typeof fileNameFromName !== 'function') return sources;
  for (const item of items) {
    const eq = item.indexOf('=');
    if (eq <= 0 || eq >= item.length - 1) continue;
    const name = item.slice(0, eq);
    const url = item.slice(eq + 1);
    const sha256 = hashes && hashes[name] ? hashes[name] : null;
    sources.push({ name, url, file: fileNameFromName(name), sha256 });
  }
  return sources;
}
