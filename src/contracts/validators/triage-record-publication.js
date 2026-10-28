import { createHash } from 'node:crypto';
import { stableStringify } from '../../shared/stable-json.js';
import { TRIAGE_PUBLICATION_FIELD, TRIAGE_SUPPORTED_RENDERER_VERSIONS, TRIAGE_PUBLICATION_LIMITS,
  TRIAGE_RECORD_PUBLICATION_SCHEMA } from '../triage-record-publication.js';

const MARKDOWN_MAX_BYTES = TRIAGE_PUBLICATION_LIMITS.markdownBytes;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = message => Object.assign(new Error(message), { code: 'ERR_TRIAGE_RECORD_PUBLICATION' });
const recordContent = value => {
  const copy = { ...value }; delete copy[TRIAGE_PUBLICATION_FIELD]; return copy;
};
export const assertTriagePublicationReceipt = (receipt, record) => {
  const keys = TRIAGE_RECORD_PUBLICATION_SCHEMA.required;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || !record || typeof record !== 'object' || Array.isArray(record)
    || Object.keys(receipt).length !== keys.length || keys.some(key => !Object.hasOwn(receipt, key))
    || receipt.schemaVersion !== 1 || !TRIAGE_SUPPORTED_RENDERER_VERSIONS.includes(receipt.rendererVersion)
    || typeof receipt.recordId !== 'string' || !receipt.recordId || receipt.recordId.length > 4096
    || receipt.recordId !== record.recordId || typeof receipt.generation !== 'string' || !/^[a-f0-9]{32}$/u.test(receipt.generation)
    || typeof receipt.recordHash !== 'string' || !/^[a-f0-9]{64}$/u.test(receipt.recordHash)
    || typeof receipt.markdownHash !== 'string' || !/^[a-f0-9]{64}$/u.test(receipt.markdownHash)
    || !Number.isSafeInteger(receipt.markdownBytes) || receipt.markdownBytes < 1 || receipt.markdownBytes > MARKDOWN_MAX_BYTES
    || sha256(stableStringify(recordContent(record))) !== receipt.recordHash) throw invalid('Invalid triage publication identity.');
  return receipt;
};

/** JSON-only consumers retain the original public record, while their existing
 * descriptor observation still hashes the complete selected wire snapshot.
 */
export const triageRecordContent = record => {
  if (record && Object.hasOwn(record, TRIAGE_PUBLICATION_FIELD)) {
    assertTriagePublicationReceipt(record[TRIAGE_PUBLICATION_FIELD], record); return recordContent(record);
  }
  return record;
};
