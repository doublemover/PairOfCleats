import { setOwn } from '../../../shared/object-record.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { sortStrings } from './constants.js';
import { normalizeTfPostingList } from './id-lists.js';
import { DEFAULT_POSTINGS_WORK_BATCH, normalizeTfPostingsWork, runPostingsWork, sortPostingsWork } from './cooperative-work.js';

const activeInputs = new WeakSet(), consumedInputs = new WeakSet();
const inputFailure = () => Object.assign(new Error('Postings inputs belong to an active or consumed attempt; rebuild its index state before retry.'),
  { code: 'ERR_POSTINGS_INPUT_CONSUMED' });

/** Token/field assembly consumes each source map only after capturing its owned
 * entries. Once consumption starts, cancellation makes this attempt terminal.
 * Reservations remain with the caller until all cooperative waits settle. */
export const buildTokenAndFieldPostings = async ({
  sparseEnabled, tokenPostings, tokenIdMap, fieldPostings, fieldDocLengths,
  normalizedDocLengths, requestYield, signal = null, workBatchSize = DEFAULT_POSTINGS_WORK_BATCH
} = {}) => {
  throwIfAborted(signal);
  if (!Number.isSafeInteger(workBatchSize) || workBatchSize < 1 || workBatchSize > 4096) throw new TypeError('Invalid postings work batch.');
  const inputs = [...new Set([tokenPostings, ...Object.values(fieldPostings || {})]
    .filter(value => value && typeof value === 'object'))];
  if (inputs.some(value => activeInputs.has(value) || consumedInputs.has(value))) throw inputFailure();
  for (const input of inputs) activeInputs.add(input);
  let consumed = false;
  const consume = map => {
    throwIfAborted(signal);
    if (typeof map?.clear === 'function') {
      if (!Number.isSafeInteger(map.size) || map.size > 0) consumed = true;
      map.clear();
    }
  };
  function* materialize() {
    let tokenVocab = [], tokenVocabIds = [], tokenPostingsList = [];
    if (sparseEnabled) {
      let includeTokenIds = tokenIdMap && tokenIdMap.size > 0;
      const entries = [];
      for (const [id, posting] of tokenPostings.entries()) {
        const mapped = tokenIdMap?.get(id);
        if (!mapped) includeTokenIds = false;
        entries.push({ id, token: mapped ?? (typeof id === 'string' ? id : String(id)), posting });
        if (entries.length % workBatchSize === 0) yield { phase: 'token-vocabulary', units: workBatchSize };
      }
      if (entries.length % workBatchSize) yield { phase: 'token-vocabulary', units: entries.length % workBatchSize };
      yield* sortPostingsWork(entries, (left, right) => sortStrings(left.token, right.token), workBatchSize, 'token-vocabulary-sort');
      tokenVocab = new Array(entries.length);
      tokenVocabIds = includeTokenIds ? new Array(entries.length) : null;
      tokenPostingsList = new Array(entries.length);
      let postingUnits = 0;
      for (let index = 0; index < entries.length; index++) {
        throwIfAborted(signal);
        const entry = entries[index];
        tokenVocab[index] = entry.token;
        if (tokenVocabIds) tokenVocabIds[index] = entry.id;
        const units = Array.isArray(entry.posting) ? Math.max(1, entry.posting.length) : 1;
        if (postingUnits && postingUnits + units > workBatchSize) {
          yield { phase: 'token-posting', units: postingUnits }; postingUnits = 0;
        }
        tokenPostingsList[index] = units > workBatchSize
          ? yield* normalizeTfPostingsWork(entry.posting, workBatchSize) : normalizeTfPostingList(entry.posting);
        entry.posting = null;
        postingUnits += units > workBatchSize ? 1 : units;
        if (postingUnits >= workBatchSize) { yield { phase: 'token-posting', units: postingUnits }; postingUnits = 0; }
      }
      if (postingUnits) yield { phase: 'token-posting', units: postingUnits };
    }
    consume(tokenPostings);
    let totalLength = 0;
    for (let index = 0; index < normalizedDocLengths.length; index++) {
      totalLength += normalizedDocLengths[index];
      if ((index + 1) % workBatchSize === 0) yield { phase: 'document-lengths', units: workBatchSize };
    }
    const avgDocLen = normalizedDocLengths.length ? totalLength / normalizedDocLengths.length : 0;
    let fieldPostingsResult = null;
    if (sparseEnabled && fieldPostings && fieldDocLengths) {
      const fields = {};
      const fieldEntries = Object.entries(fieldPostings);
      yield* sortPostingsWork(fieldEntries, (left, right) => sortStrings(left[0], right[0]), workBatchSize, 'field-order');
      for (const [field, postingsMap] of fieldEntries) {
        throwIfAborted(signal);
        if (!postingsMap || typeof postingsMap.entries !== 'function') continue;
        const entries = [];
        for (const [token, posting] of postingsMap.entries()) {
          entries.push([token, posting]);
          if (entries.length % workBatchSize === 0) yield { phase: 'field-vocabulary', field, units: workBatchSize };
        }
        if (entries.length % workBatchSize) yield { phase: 'field-vocabulary', field, units: entries.length % workBatchSize };
        consume(postingsMap);
        yield* sortPostingsWork(entries, (left, right) => sortStrings(left[0], right[0]), workBatchSize, 'field-vocabulary-sort');
        const vocab = new Array(entries.length), postings = new Array(entries.length);
        let postingUnits = 0;
        for (let index = 0; index < entries.length; index++) {
          throwIfAborted(signal);
          const entry = entries[index]; vocab[index] = entry[0];
          const units = Array.isArray(entry[1]) ? Math.max(1, entry[1].length) : 1;
          if (postingUnits && postingUnits + units > workBatchSize) {
            yield { phase: 'field-posting', field, units: postingUnits }; postingUnits = 0;
          }
          postings[index] = units > workBatchSize
            ? yield* normalizeTfPostingsWork(entry[1], workBatchSize) : normalizeTfPostingList(entry[1]);
          entry[1] = null;
          postingUnits += units > workBatchSize ? 1 : units;
          if (postingUnits >= workBatchSize) { yield { phase: 'field-posting', field, units: postingUnits }; postingUnits = 0; }
        }
        if (postingUnits) yield { phase: 'field-posting', field, units: postingUnits };
        const raw = fieldDocLengths[field] || [], lengths = Array.isArray(raw) ? new Array(raw.length) : [];
        let lengthSum = 0;
        for (let index = 0; index < lengths.length; index++) {
          const length = Number.isFinite(raw[index]) ? raw[index] : 0;
          lengths[index] = length; lengthSum += length;
          if ((index + 1) % workBatchSize === 0) yield { phase: 'field-lengths', field, units: workBatchSize };
        }
        setOwn(fields, field, { vocab, postings, docLengths: lengths,
          avgDocLen: lengths.length ? lengthSum / lengths.length : 0, totalDocs: lengths.length });
        yield { phase: 'field-complete', field, units: 1 };
      }
      if (Object.keys(fields).length) fieldPostingsResult = { fields };
    }
    yield { phase: 'before-success', units: 0 };
    return { tokenVocab, tokenVocabIds, tokenPostingsList, avgDocLen, fieldPostingsResult };
  }
  try {
    const result = runPostingsWork(materialize(), { signal, requestYield });
    return result && typeof result.then === 'function' ? await result : result;
  } finally {
    for (const input of inputs) {
      activeInputs.delete(input);
      if (consumed) consumedInputs.add(input);
    }
  }
};
