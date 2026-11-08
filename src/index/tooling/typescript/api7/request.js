import { createHash } from 'node:crypto';
import { snapshotPlainData } from '../../../../shared/plain-data-snapshot.js';
import { stableStringify } from '../../../../shared/stable-json.js';
import { typescriptApi7RequestSchema } from '../../../../contracts/schemas/typescript-api7.js';
import { createAjv } from '../../../../shared/validation/ajv-factory.js';

const validate = createAjv().compile(typescriptApi7RequestSchema);
export const api7Failure = (reason, cause) => Object.assign(new Error('TypeScript7.1 API: ' + reason, { cause }),
  { code: 'ERR_TYPESCRIPT_API7', reason });
export const api7Identity = data => createHash('sha256').update(stableStringify(data)).digest('hex');
const pathKey = file => file.toLowerCase();
const safePath = file => file.split('/').every(part => part && part !== '.' && part !== '..'
  && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));

/** Own source and query containers before any lease or cooperative yield. The
 * profile is Windows-case-insensitive; path aliases cannot name two sources. */
export const captureTypeScriptApi7Request = input => {
  const request = snapshotPlainData(input, { maxBytes: 4 * 1024 * 1024, maxDepth: 6, maxItems: 128,
    code: 'ERR_TYPESCRIPT_API7', label: 'TypeScript7.1 request', nullPrototype: false, freeze: true });
  if (!validate(request)) throw api7Failure('invalid-request');
  const files = new Map(), directories = new Set(), ids = new Set();
  for (const item of request.files) {
    const key = pathKey(item.path);
    if (!safePath(item.path) || files.has(key)) throw api7Failure('ambiguous-source-path');
    files.set(key, item);
    const parts = key.split('/'); parts.pop();
    while (parts.length) { directories.add(parts.join('/')); parts.pop(); }
  }
  for (const key of files.keys()) if (directories.has(key)) throw api7Failure('source-directory-collision');
  const selected = request.project.kind === 'roots' ? request.project.roots : request.project.configFiles;
  if (selected.some(file => !safePath(file) || files.get(pathKey(file))?.path !== file)
    || new Set(selected.map(pathKey)).size !== selected.length) throw api7Failure('project-source-not-admitted');
  for (const query of request.queries) {
    const source = files.get(pathKey(query.path));
    if (ids.has(query.id) || !source || source.path !== query.path || query.position > source.text.length
      || request.project.kind === 'roots' && query.configFile !== undefined
      || request.project.kind === 'configured' && !selected.includes(query.configFile)) throw api7Failure('invalid-query-authority');
    ids.add(query.id);
  }
  return request;
};

export const TYPESCRIPT_API7_LIMITS = Object.freeze({ maxRecordBytes: 8 * 1024 * 1024, maxInputBytes: 8 * 1024 * 1024,
  maxOutputBytes: 8 * 1024 * 1024, maxRecords: 2, maxDepth: 64 });

// Derived from the pinned SDK's configureFileSystemCallbacks, checked again by
// the SDK worker before it opens the API connection. No OS fallback or project
// plugin execution is admitted by the native process owner.
export const TYPESCRIPT_API7_FS_CALLBACKS = 'readFile:error,fileExists:error,directoryExists:error,getAccessibleEntries:error,realpath:error,stat:error,writeFile:error,removeFile:error';
