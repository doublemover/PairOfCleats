import { loadJsonArrayArtifact, loadTokenPostings } from '../../shared/artifact-io.js';
import { hashDeterministicValues } from '../../shared/invariants.js';
import { addIssue } from './issues.js';
import {
  normalizeFieldPostings,
  normalizeMinhash,
  normalizePhrasePostings,
  normalizeTokenPostings
} from './normalize.js';
import { validateSchema } from './schema.js';
import { validateIdPostings, validatePostingsDocIds } from './checks.js';

const hashVocabList = (vocab) => hashDeterministicValues(vocab);

export const validateCorePostingsArtifacts = ({
  report,
  mode,
  dir,
  manifest,
  strict,
  modeReport,
  chunkMeta,
  postingsConfig,
  resolvePresence,
  hasLegacyArtifact,
  readJsonArtifact
}) => {
  if (postingsConfig.fielded && chunkMeta.length > 0) {
    const missingFieldArtifacts = [];
    const isMissingFieldArtifact = (name) => {
      if (strict) {
        const presence = resolvePresence(name);
        return !presence || presence.format === 'missing' || presence.error;
      }
      return !hasLegacyArtifact(name);
    };
    if (isMissingFieldArtifact('field_postings')) missingFieldArtifacts.push('field_postings');
    if (isMissingFieldArtifact('field_tokens')) missingFieldArtifacts.push('field_tokens');
    if (missingFieldArtifacts.length) {
      modeReport.ok = false;
      modeReport.missing.push(...missingFieldArtifacts);
      missingFieldArtifacts.forEach((artifact) => {
        report.issues.push(`[${mode}] missing ${artifact}`);
        report.hints.push('Run `pairofcleats index build` to rebuild missing artifacts.');
      });
    }
  }

  let tokenNormalized = null;
  let phraseNormalized = null;
  let chargramNormalized = null;

  try {
    const tokenIndex = loadTokenPostings(dir, { manifest, strict });
    tokenNormalized = normalizeTokenPostings(tokenIndex);
  } catch (err) {
    addIssue(report, mode, `token_postings load failed (${err?.code || err?.message || err})`, 'Rebuild index artifacts for this mode.');
    modeReport.ok = false;
  }
  if (tokenNormalized) {
    validateSchema(
      report,
      mode,
      'token_postings',
      tokenNormalized,
      'Rebuild index artifacts for this mode.',
      { strictSchema: strict }
    );
    const vocabIds = Array.isArray(tokenNormalized.vocabIds) ? tokenNormalized.vocabIds : [];
    if (vocabIds.length && vocabIds.length !== tokenNormalized.vocab.length) {
      const issue = `token_postings vocabIds mismatch (${vocabIds.length} !== ${tokenNormalized.vocab.length})`;
      modeReport.ok = false;
      modeReport.missing.push(issue);
      report.issues.push(`[${mode}] ${issue}`);
    }
    const docLengths = tokenNormalized.docLengths || [];
    if (docLengths.length && chunkMeta.length !== docLengths.length) {
      const issue = `docLengths mismatch (${docLengths.length} !== ${chunkMeta.length})`;
      modeReport.ok = false;
      modeReport.missing.push(issue);
      report.issues.push(`[${mode}] ${issue}`);
    }
    validatePostingsDocIds(report, mode, 'token_postings', tokenNormalized.postings, chunkMeta.length);
  }

  const phraseRaw = readJsonArtifact('phrase_ngrams');
  if (phraseRaw) {
    phraseNormalized = normalizePhrasePostings(phraseRaw);
    validateSchema(report, mode, 'phrase_ngrams', phraseNormalized, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
    validateIdPostings(report, mode, 'phrase_ngrams', phraseNormalized.postings, chunkMeta.length);
  }

  const chargramRaw = readJsonArtifact('chargram_postings');
  if (chargramRaw) {
    chargramNormalized = normalizePhrasePostings(chargramRaw);
    validateSchema(report, mode, 'chargram_postings', chargramNormalized, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
    validateIdPostings(report, mode, 'chargram_postings', chargramNormalized.postings, chunkMeta.length);
  }

  return {
    tokenNormalized,
    phraseNormalized,
    chargramNormalized,
    vocabHashes: {
      token: tokenNormalized ? hashVocabList(tokenNormalized.vocab) : null,
      phrase: phraseNormalized ? hashVocabList(phraseNormalized.vocab) : null,
      chargram: chargramNormalized ? hashVocabList(chargramNormalized.vocab) : null
    }
  };
};

export const validateSupplementalPostingsArtifacts = async ({
  report,
  mode,
  dir,
  manifest,
  strict,
  modeReport,
  chunkMeta,
  shouldLoadOptional,
  readJsonArtifact,
  vocabHashes
}) => {
  const minhashRaw = readJsonArtifact('minhash_signatures');
  if (minhashRaw) {
    const minhash = normalizeMinhash(minhashRaw);
    validateSchema(report, mode, 'minhash_signatures', minhash, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
    const signatures = minhash.signatures || [];
    if (signatures.length && signatures.length !== chunkMeta.length) {
      const issue = `minhash mismatch (${signatures.length} !== ${chunkMeta.length})`;
      modeReport.ok = false;
      modeReport.missing.push(issue);
      report.issues.push(`[${mode}] ${issue}`);
    }
  }

  let fieldTokens = null;
  if (shouldLoadOptional('field_tokens')) {
    try {
      fieldTokens = await loadJsonArrayArtifact(dir, 'field_tokens', { manifest, strict });
    } catch (err) {
      addIssue(report, mode, `field_tokens load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
    }
  }
  if (fieldTokens) {
    validateSchema(report, mode, 'field_tokens', fieldTokens, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
    if (Array.isArray(fieldTokens) && fieldTokens.length !== chunkMeta.length) {
      const issue = `field_tokens mismatch (${fieldTokens.length} !== ${chunkMeta.length})`;
      modeReport.ok = false;
      modeReport.missing.push(issue);
      report.issues.push(`[${mode}] ${issue}`);
    }
  }

  const fieldPostingsRaw = readJsonArtifact('field_postings', { allowOversize: true });
  const fieldPostings = normalizeFieldPostings(fieldPostingsRaw);
  if (fieldPostings) {
    validateSchema(report, mode, 'field_postings', fieldPostings, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
    const fields = fieldPostings.fields || {};
    for (const entry of Object.values(fields)) {
      validatePostingsDocIds(report, mode, 'field_postings', entry?.postings, chunkMeta.length);
      const lengths = Array.isArray(entry?.docLengths) ? entry.docLengths : [];
      if (lengths.length && lengths.length !== chunkMeta.length) {
        const issue = `field_postings docLengths mismatch (${lengths.length} !== ${chunkMeta.length})`;
        modeReport.ok = false;
        modeReport.missing.push(issue);
        report.issues.push(`[${mode}] ${issue}`);
      }
    }
  }

  const vocabOrder = readJsonArtifact('vocab_order');
  if (vocabOrder && typeof vocabOrder === 'object') {
    const tokenHash = vocabHashes?.token || null;
    const phraseHash = vocabHashes?.phrase || null;
    const chargramHash = vocabHashes?.chargram || null;
    const vocab = vocabOrder?.fields?.vocab || vocabOrder?.vocab || null;
    const expectToken = vocab?.token?.hash || null;
    const expectPhrase = vocab?.phrase?.hash || null;
    const expectChargram = vocab?.chargram?.hash || null;
    if (expectToken && tokenHash?.hash && expectToken !== tokenHash.hash) {
      addIssue(report, mode, 'vocab_order token hash mismatch', 'Rebuild index artifacts for this mode.');
      modeReport.ok = false;
    }
    if (expectPhrase && phraseHash?.hash && expectPhrase !== phraseHash.hash) {
      addIssue(report, mode, 'vocab_order phrase hash mismatch', 'Rebuild index artifacts for this mode.');
      modeReport.ok = false;
    }
    if (expectChargram && chargramHash?.hash && expectChargram !== chargramHash.hash) {
      addIssue(report, mode, 'vocab_order chargram hash mismatch', 'Rebuild index artifacts for this mode.');
      modeReport.ok = false;
    }
  }

};
