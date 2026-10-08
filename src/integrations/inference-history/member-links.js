import path from 'node:path';
import { historyError } from './common.js';
const invalid = () => historyError('ERR_INFERENCE_HISTORY_INPUT', 'Invalid inference-history member metadata.');
export function normalizeMemberLinks(raw, kind, member, maxEntries) {
  const links = [];
  const prefix = path.posix.dirname(member);
  const add = (relation, logicalId, declaredPath, bytes = null) => {
    if (typeof declaredPath !== 'string' || !declaredPath || declaredPath.length > 4096
      || /[\\:\u0000-\u001f]/u.test(declaredPath) || declaredPath.startsWith('/')
      || declaredPath.split('/').some(part => !part || part === '.' || part === '..')) throw invalid();
    if (bytes !== null && (!Number.isSafeInteger(bytes) || bytes < 0)) throw invalid();
    if (links.length >= maxEntries) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'Member linkage limit exceeded.');
    const memberPath = prefix === '.' || declaredPath.startsWith(prefix + '/') ? declaredPath : prefix + '/' + declaredPath;
    links.push({ relation, logicalId, declaredPath, memberPath, bytes });
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid();
  if (kind === 'asset_names') {
    for (const [file, label] of Object.entries(raw)) {
      if (typeof label !== 'string') throw invalid();
      add('named_asset', file, file);
    }
  } else if (kind === 'export_manifest') {
    if (!Array.isArray(raw.export_files) || !raw.logical_files || typeof raw.logical_files !== 'object'
      || Array.isArray(raw.logical_files)) throw invalid();
    for (const file of raw.export_files) {
      if (!file || typeof file !== 'object' || Array.isArray(file)) throw invalid();
      add('export_file', file.path, file.path, file.size_bytes);
    }
    for (const [logicalId, value] of Object.entries(raw.logical_files)) {
      if (!value || !Array.isArray(value.files) || typeof value.sharded !== 'boolean') throw invalid();
      for (const file of value.files) add('logical_member', logicalId, file);
    }
  } else throw invalid();
  return links;
}
