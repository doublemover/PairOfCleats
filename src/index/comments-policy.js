// Private extraction policy identity, separate from artifact layout versions.
export const COMMENT_CLASSIFICATION_VERSION = '7';
// Match legal-notice structures at a comment line boundary. Bare license names
// inside prose (including submit/commit/permit/limits) are deliberately ambiguous.
const line = String.raw`(?:^|[\r\n])[\t ]*(?:(?:/\*+!?|//[!/]?|\*+|<!--|#+|;|--)[\t ]*)?`;
const spdx = String.raw`SPDX-License-Identifier[\t ]*:[\t ]*[a-z0-9][a-z0-9.+-]*`;
const copyright = String.raw`(?:copyright[\t ]+(?:\(c\)|©|\d{4})(?:[\t ]|$)|©[\t ]*\d{4}(?:[\t ]|$))`;
const notice = String.raw`(?:(?:MIT|Apache) License(?:,?[\t ]+Version[\t ]+[0-9.]+)?[\t ]*(?:\*/|-->)?[\t ]*(?:$|[\r\n])|License[\t ]*:[\t ]*(?:MIT|Apache-2\.0|BSD-[23]-Clause|(?:A?GPL|LGPL)-[123]\.[0-9])(?:-only|-or-later)?(?:[\t\r\n ]|$)|Licensed under[\t ]+(?:the[\t ]+)?[a-z0-9]|Permission is hereby granted,[\t ]+free of charge)`;
export const DEFAULT_COMMENT_LICENSE_PATTERN = `${line}(?:(${spdx})|(${copyright})|(${notice}))`;

const fields = ['extract', 'includeInCode', 'includeLicense', 'minDocChars', 'minInlineChars', 'minTokens',
  'maxPerChunk', 'maxBytesPerChunk', 'headerMaxLines', 'skipGenerated', 'skipLinter'];
const patternReceipt = pattern => pattern == null ? null : typeof pattern === 'string' ? { source: pattern, flags: 'i' } : {
  source: pattern.source, flags: pattern.flags, engine: pattern.engine || null,
  config: pattern.config ? Object.fromEntries(['maxPatternLength', 'maxInputLength', 'maxProgramSize', 'timeoutMs', 'flags']
    .map(key => [key, pattern.config[key]])) : null
};

/** Effective normalized policy only: no matcher cursor, compiled handle or dictionary state. */
export const commentPolicyReceipt = config => ({ version: COMMENT_CLASSIFICATION_VERSION,
  ...Object.fromEntries(fields.map(key => [key, config?.[key]])),
  ...Object.fromEntries(['licensePattern', 'generatedPattern', 'linterPattern'].map(key => [key, patternReceipt(config?.[key])]))
});
