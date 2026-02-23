/**
 * Retrieval output formatting public surface.
 * Re-exports rendering helpers while keeping formatter internals private.
 */
export { RESULT_BUNDLE_SCHEMA_VERSION, buildResultBundles } from './format/bundle.js';
export { formatFullChunk } from './format/full.js';
export { formatShortChunk } from './format/short.js';
export { compareText, formatControlFlow, formatSignature, formatWrappedList, formatVerticalList } from './format/display-meta.js';
export { boldText, colorText, labelToken, stripAnsi, styleText } from './format/ansi.js';
