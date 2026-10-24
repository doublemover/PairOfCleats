const fs = require('node:fs');
const path = require('node:path');
const { captureEditorFailure, editorFailureEvidence } = require('./editor-failure-evidence.js');

/** The existing semantic CLI request file has one exact extension-storage
 * owner. Failed retirement remains owned evidence, never successful output. */
async function withSemanticRequestFile({ storage, request, operations, execute }) {
  if (!storage) throw new Error('Extension-owned request storage is unavailable.');
  fs.mkdirSync(storage, { recursive: true });
  const directory = fs.mkdtempSync(path.join(storage, 'semantic-request-'));
  const requestPath = path.join(directory, 'request.json');
  let result, primaryError, hasPrimary = false;
  try {
    fs.writeFileSync(requestPath, JSON.stringify(request), { encoding: 'utf8', flag: 'wx' });
    result = await execute(requestPath);
  } catch (error) { primaryError = error; hasPrimary = true; }
  const failures = [];
  const retire = callback => {
    try { callback(); } catch (error) {
      let missing = false, inspectionFailure = null;
      try { missing = error?.code === 'ENOENT'; }
      catch (inspection) { inspectionFailure = captureEditorFailure(inspection); }
      if (!missing) {
        failures.push(captureEditorFailure(error));
        if (inspectionFailure) failures.push(inspectionFailure);
      }
    }
  };
  retire(() => fs.unlinkSync(requestPath));
  retire(() => fs.rmdirSync(directory));
  if (failures.length) {
    const evidence = editorFailureEvidence([...(hasPrimary ? [captureEditorFailure(primaryError)] : []), ...failures]);
    operations.retainUnconfirmed(Object.freeze({ directory, requestPath }), evidence);
    // Preserve the exact original command failure if one preceded retirement.
    // Additional cleanup/inspection failures remain on the same host owner.
    throw hasPrimary ? primaryError : failures[0].primaryError;
  }
  if (hasPrimary) throw primaryError;
  return result;
}

module.exports = { withSemanticRequestFile };
