import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { EMBEDDED_SOURCE_MAP_SCHEMA } from '../schemas/embedded-source-map.js';
import { assertEmbeddedContentView } from '../../shared/embedded-content.js';

const ajv = createAjv({ allErrors: true, strict: true });
const validate = compileSchema(ajv, EMBEDDED_SOURCE_MAP_SCHEMA);
export const assertEmbeddedSourceMap = value => {
  if (!validate(value)) throw Object.assign(new TypeError('Invalid embedded source map: ' + ajv.errorsText(validate.errors)), {
    code: 'ERR_EMBEDDED_SOURCE_MAP_CONTRACT'
  });
  const view = value?.contentView;
  let invalidPieces = false;
  if (value?.schemaVersion === 2 && view) {
    try { assertEmbeddedContentView(view); } catch { invalidPieces = true; }
    let cursor = 0, parentEnd = view.containerStart;
    for (const piece of view.pieces || []) {
      if (piece.localStart !== cursor || piece.start < parentEnd || piece.end <= piece.start
        || piece.localEnd !== cursor + piece.end - piece.start) invalidPieces = true;
      cursor = piece.localEnd; parentEnd = piece.end;
    }
    invalidPieces ||= cursor !== view.length || view.length !== value.localEnd
      || view.pieces?.[0]?.start !== view.sourceStart || view.pieces?.at(-1)?.end !== view.sourceEnd
      || view.sourceStart !== value.parentStart || view.sourceEnd !== value.parentEnd
      || view.containerStart > view.sourceStart || view.containerEnd < view.sourceEnd;
  }
  if (value.parentEnd <= value.parentStart
    || invalidPieces || value.schemaVersion === 1 && value.quality === 'exact' && value.localEnd !== value.parentEnd - value.parentStart) {
    throw Object.assign(new TypeError('Invalid embedded source map: ' + ajv.errorsText(validate.errors)), {
      code: 'ERR_EMBEDDED_SOURCE_MAP_CONTRACT'
    });
  }
  return value;
};
