const fail = (message, cause = undefined) => Object.assign(new Error(message, { cause }), { code: 'ERR_DOCX_XML_ENCODING' });

export const assertDocxXmlCharacters = text => {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(text)) {
    throw fail('DOCX XML contains unsupported XML 1.0 characters.');
  }
};

export const assertDocxXmlDeclaration = text => {
  if (/^<\?xml(?:\s|\?)/i.test(text)) {
    const end = text.slice(0, 1024).indexOf('?>');
    if (end < 0) throw fail('DOCX XML declaration exceeds its supported header allowance.');
    const declaration = text.slice(0, end + 2).match(/^<\?xml\s+version\s*=\s*(["'])1\.0\1(?:\s+encoding\s*=\s*(["'])([A-Za-z][A-Za-z0-9._-]*)\2)?(?:\s+standalone\s*=\s*(["'])(?:yes|no)\4)?\s*\?>$/);
    if (!declaration) throw fail('DOCX XML declaration is unsupported or malformed.');
    const declared = declaration[3]?.toLowerCase();
    if (declared && !['utf-8', 'utf8'].includes(declared)) throw fail('DOCX XML declaration differs from its supported UTF-8 byte encoding.');
  }
};

/** UTF-8 XML 1.0, with an optional UTF-8 BOM, before provider work. Other byte
 * encodings are rejected explicitly rather than decoded as replacement text. */
export const decodeDocxXmlBytes = bytes => {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('DOCX XML bytes required.');
  if (bytes.length >= 4 && (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0
    || bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)) {
    throw fail('DOCX XML UTF-32 encoding is unsupported.');
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0xfe && bytes[1] === 0xff) {
    throw fail('DOCX XML UTF-16 encoding is unsupported.');
  }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (cause) { throw fail('DOCX XML byte encoding is malformed.', cause); }
  assertDocxXmlDeclaration(text);
  return text;
};
