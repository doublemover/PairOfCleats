import path from 'node:path';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';
import { isWithinRoot } from '../../workspace/identity.js';

/** Resolve only an already-authorized physical source mapping. This performs
 * no discovery and proves neither browser resource mapping nor runtime launch.
 * @returns {{state:'resolved',path:string}|{state:'unresolved',reason:string}}
 */
export const resolveSourceFileUrl = ({ repoRoot, containerPath, literal }) => {
  if (typeof containerPath !== 'string' || !containerPath || typeof repoRoot !== 'string' || !repoRoot) {
    return { state: 'unresolved', reason: 'physical_origin_unavailable' };
  }
  if (typeof literal !== 'string' || !literal.startsWith('.') || /[?#\\]/.test(literal)) {
    return { state: 'unresolved', reason: 'relative_url_required' };
  }
  if (/%(?:2f|5c)/i.test(literal)) return { state: 'unresolved', reason: 'encoded_separator' };
  if (/%(?![a-f\d]{2})/i.test(literal)) return { state: 'unresolved', reason: 'malformed_encoding' };
  const root = path.resolve(repoRoot), container = path.resolve(root, containerPath);
  if (!isWithinRoot(container, root)) return { state: 'unresolved', reason: 'physical_origin_outside_inventory' };
  try {
    const url = new URL(literal, pathToFileURL(container));
    if (url.protocol !== 'file:' || url.search || url.hash || url.username || url.password) {
      return { state: 'unresolved', reason: 'unsupported_file_url' };
    }
    const filename = fileURLToPath(url);
    if (filename.includes('\0')) return { state: 'unresolved', reason: 'invalid_file_path' };
    if (!isWithinRoot(filename, root)) return { state: 'unresolved', reason: 'outside_inventory' };
    return { state: 'resolved', path: filename };
  } catch { return { state: 'unresolved', reason: 'malformed_encoding' }; }
};
