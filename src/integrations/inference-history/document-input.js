import { historyError } from './common.js';

/** The complete prefixed string is both the cache identity and the model input. */
export function archiveDocumentInput(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)
    || Object.keys(document).some(key => !['text', 'title'].includes(key))
    || typeof document.text !== 'string'
    || (document.title !== undefined && typeof document.title !== 'string')) {
    throw historyError('ERR_INFERENCE_HISTORY_INPUT', 'Archive document text and context required.');
  }
  const title = (document.title ?? '').replace(/[\r\n\t\u0000-\u001f|]+/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 512) || 'none';
  return 'title: ' + title + ' | text: ' + document.text;
}
