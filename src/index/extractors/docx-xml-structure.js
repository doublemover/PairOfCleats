import sax from 'sax';
import { assertDocxXmlCharacters, assertDocxXmlDeclaration } from './docx-xml-bytes.js';
import { throwIfAborted } from '../../shared/abort.js';

const WORD_NS = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main']);
export const isWordNode = (node, local) => WORD_NS.has(node?.uri) && node.local === local;
export const wordAttribute = (node, local) => Object.values(node.attributes).find(
  attribute => WORD_NS.has(attribute.uri) && attribute.local === local)?.value;

/** One namespace-aware, bounded event reader for admitted Word document/style
 * bytes. Consumers own structural roles; comments/DTD never manufacture nodes. */
export const readDocxXmlStructure = (xml, { rootName, maxChars = 64 * 1024 * 1024, timeoutMs = 15000,
  signal = null, open = () => {}, text = () => {}, close = () => {} } = {}) => {
  const limit = message => Object.assign(new Error(message), { code: 'ERR_DOCX_XML_LIMIT' });
  if (typeof xml !== 'string' || !Number.isSafeInteger(maxChars) || maxChars < 1 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Bounded DOCX XML text required.');
  }
  if (xml.length > Math.min(maxChars, 64 * 1024 * 1024)) throw limit('DOCX XML character allowance exceeded.');
  const deadline = performance.now() + timeoutMs;
  const check = () => {
    throwIfAborted(signal);
    if (performance.now() >= deadline) throw Object.assign(new Error('DOCX XML parsing timed out.'), { code: 'EXTRACT_TIMEOUT' });
  };
  check(); assertDocxXmlCharacters(xml); assertDocxXmlDeclaration(xml);
  const parser = sax.parser(true, { xmlns: true, strictEntities: true }), stack = [];
  let nodes = 0, events = 0, attributes = 0, rootSeen = false, declarationSeen = false;
  const event = () => {
    if (++events > 1000000) throw limit('DOCX XML token allowance exceeded.');
    if ((events & 63) === 0) check();
  };
  parser.onopentagstart = () => { event(); attributes = 0;
    if (++nodes > 250000 || stack.length >= 256) throw limit('DOCX XML node/depth allowance exceeded.'); };
  parser.onattribute = attribute => { event();
    if (++attributes > 128) throw limit('DOCX XML attribute allowance exceeded.');
    assertDocxXmlCharacters(attribute.value); };
  parser.oncomment = event;
  parser.onprocessinginstruction = instruction => { event();
    if (instruction.name.toLowerCase() === 'xml') {
      if (declarationSeen || rootSeen || instruction.name !== 'xml' || !xml.startsWith('<?xml')) throw new Error('DOCX XML declaration must appear once at the beginning.');
      declarationSeen = true;
    } };
  parser.ondoctype = () => { throw new Error('DOCX XML must not contain a DTD.'); };
  parser.onopentag = node => {
    if (!stack.length) {
      if (rootSeen || !isWordNode(node, rootName)) throw new Error('DOCX XML root must be a supported WordprocessingML ' + rootName + '.');
      rootSeen = true;
    }
    open(node, stack); stack.push(node);
  };
  parser.ontext = value => { event(); assertDocxXmlCharacters(value); text(value, stack); };
  parser.oncdata = parser.ontext;
  parser.onclosetag = () => { const node = stack.pop(); close(node, stack); };
  for (let offset = 0; offset < xml.length; offset += 16384) { check(); parser.write(xml.slice(offset, offset + 16384)); }
  parser.close(); check();
  if (!rootSeen) throw new Error('DOCX XML document root is missing.');
};

export const builtinDocxHeadingLevel = style => {
  const match = /^heading[ _-]*([1-9])$/i.exec(style || '');
  return match ? Number(match[1]) : null;
};

export const parseDocxStyles = (xml, options = {}) => {
  const styles = new Map(), warnings = new Set(); let current = null;
  if (xml !== null) readDocxXmlStructure(xml, { ...options, rootName: 'styles',
    open(node, stack) {
      if (isWordNode(node, 'style') && stack.length !== 1) throw new Error('Nested DOCX styles are unsupported.');
      if (isWordNode(node, 'style') && stack.length === 1 && wordAttribute(node, 'type') === 'paragraph') {
        const id = wordAttribute(node, 'styleId');
        if (!id || styles.has(id) || styles.size >= 10000) throw new Error('DOCX paragraph styles require bounded unique identities.');
        current = { id, basedOn: null, level: undefined };
      } else if (current && isWordNode(stack.at(-1), 'style') && isWordNode(node, 'basedOn')) current.basedOn = wordAttribute(node, 'val');
      else if (current && isWordNode(stack.at(-1), 'pPr') && isWordNode(stack.at(-2), 'style') && isWordNode(node, 'outlineLvl')) {
        const value = wordAttribute(node, 'val');
        if (!/^[0-9]$/.test(value || '')) throw new Error('DOCX outline level must be 0..9.');
        current.level = value === '9' ? null : Number(value) + 1;
      }
    },
    close(node) { if (current && isWordNode(node, 'style')) { styles.set(current.id, current); current = null; } }
  });
  return { warnings, resolveLevel(id) {
    const seen = new Set(); let next = id;
    while (next) {
      if (seen.has(next) || seen.size >= 64) { warnings.add('DOCX paragraph style inheritance is cyclic or exceeds its depth allowance.'); return null; }
      seen.add(next); const style = styles.get(next);
      if (style?.level !== undefined) return style.level;
      const builtin = builtinDocxHeadingLevel(next);
      if (builtin !== null) return builtin;
      if (!style) { warnings.add('DOCX paragraph style has unavailable heading provenance: ' + next); return null; }
      next = style.basedOn;
    }
    return null;
  } };
};
