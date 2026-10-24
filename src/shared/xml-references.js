const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const XSD = 'http://www.w3.org/2001/XMLSchema';
const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const LEGACY_ATTRIBUTES = new Set(['schemalocation', 'href', 'src', 'location', 'file', 'path', 'url', 'project']);
const schemaNames = new Set(['schemaLocation', 'noNamespaceSchemaLocation']);

/** Namespace scopes follow only the bounded parser stack. Expanded-name and
 * reference receipts retain values/ranges, never scope Maps or external entities.
 */
export const createXmlReferenceOwner = ({ range, checkTime, fail, maxEntries = 4096 } = {}) => {
  const entries = [], observations = [], reasons = new Set();
  let namespaceProbes = 0;
  const observe = (element, attribute, state, reason) => {
    if (observations.length >= maxEntries) fail('reference-observation-limit');
    if (state === 'unsupported') reasons.add(reason);
    observations.push(Object.freeze({ state, reason, elementName: element.name, attributeName: attribute.name,
      nameRange: attribute.nameRange, valueRange: attribute.valueRange, expandedName: attribute.expandedName }));
  };
  const resolvePrefix = (scope, prefix) => {
    if (prefix === 'xml') return { state: 'bound', namespaceUri: XML };
    if (scope?.resolved.has(prefix)) return scope.resolved.get(prefix);
    const remember = result => { if (scope && scope.resolved.size < 256) scope.resolved.set(prefix, result); return result; };
    for (let current = scope, depth = 0; current && depth < 64; current = current.parent, depth++) {
      checkTime(); namespaceProbes++;
      if (current.bindings.has(prefix)) {
        const uri = current.bindings.get(prefix);
        return remember(uri === null ? { state: 'unsupported', namespaceUri: null }
          : uri === '' ? { state: prefix ? 'unbound' : 'no-namespace', namespaceUri: null }
            : { state: 'bound', namespaceUri: uri });
      }
    }
    return remember({ state: prefix ? 'unbound' : 'no-namespace', namespaceUri: null });
  };
  const expanded = (name, scope, attribute = false) => {
    const parts = name.split(':');
    if (parts.length > 2 || parts.some(part => !part)) return Object.freeze({ state: 'unsupported', prefix: null, localName: name, namespaceUri: null });
    const prefix = parts.length === 2 ? parts[0] : '', localName = parts.at(-1);
    return Object.freeze({ prefix, localName, ...(attribute && !prefix
      ? { state: 'no-namespace', namespaceUri: null } : resolvePrefix(scope, prefix)) });
  };
  const words = attribute => {
    const values = [];
    for (const match of attribute.value.matchAll(/[^ \t\r\n]+/gu)) {
      checkTime();
      if (values.length === maxEntries * 2) fail('reference-token-limit');
      values.push({ value: match[0], range: range(attribute.valueRange.start + match.index, attribute.valueRange.start + match.index + match[0].length) });
    }
    return values;
  };
  const admit = (element, attribute, value, valueRange, role, targetNamespace = null, namespaceRange = null) => {
    checkTime();
    if (entries.length >= maxEntries) fail('import-limit');
    entries.push(Object.freeze({ value, ...valueRange, nameRange: attribute.nameRange, valueRange: attribute.valueRange,
      elementName: element.name, elementExpandedName: element.expandedName, expandedName: attribute.expandedName,
      role, targetNamespace, namespaceRange, provenance: 'parsed-literal' }));
  };
  const opening = (element, parent = null) => {
    const scope = { parent, bindings: new Map(), resolved: new Map() };
    for (const attribute of element.attributes) {
      checkTime();
      if (attribute.name !== 'xmlns' && !attribute.name.startsWith('xmlns:')) continue;
      const prefix = attribute.name === 'xmlns' ? '' : attribute.name.slice(6);
      if (scope.bindings.size === 256) fail('namespace-limit');
      const value = attribute.value;
      const invalid = attribute.name !== 'xmlns' && !prefix || prefix.includes(':') || prefix === 'xmlns' || value === XMLNS
        || prefix === 'xml' && value !== XML || prefix !== 'xml' && value === XML || prefix && value === '';
      scope.bindings.set(prefix, invalid || attribute.unresolved ? null : value);
      if (invalid || attribute.unresolved) observe(element, attribute, 'unsupported', 'namespace-binding-unsupported');
    }
    element.expandedName = expanded(element.name, scope);
    const seen = new Set(), duplicates = new Set();
    element.attributes = element.attributes.map(attribute => {
      const declaration = attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:');
      const name = declaration ? Object.freeze({ state: 'declaration', namespaceUri: XMLNS, localName: attribute.name, prefix: 'xmlns' })
        : expanded(attribute.name, scope, true);
      const key = ['bound', 'no-namespace'].includes(name.state) ? JSON.stringify([name.namespaceUri, name.localName]) : null;
      if (key) { if (seen.has(key)) duplicates.add(key); else seen.add(key); }
      return Object.freeze({ ...attribute, expandedName: name });
    });
    for (const attribute of element.attributes) {
      checkTime();
      const name = attribute.expandedName;
      if (name.state === 'declaration') continue;
      const key = JSON.stringify([name.namespaceUri, name.localName]);
      if (duplicates.has(key)) { observe(element, attribute, 'unsupported', 'duplicate-expanded-attribute'); continue; }
      const schemaLike = schemaNames.has(name.localName);
      const xsi = name.state === 'bound' && name.namespaceUri === XSI && schemaLike;
      if (xsi) {
        if (attribute.unresolved) { observe(element, attribute, 'unsupported', 'unresolved-reference-value'); continue; }
        const values = words(attribute);
        if (name.localName === 'schemaLocation') {
          if (!values.length || values.length % 2) { observe(element, attribute, 'unsupported', 'schema-location-pairs'); continue; }
          for (let index = 0; index < values.length; index += 2) admit(element, attribute,
            values[index + 1].value, values[index + 1].range, 'xsi-schema-location-pair', values[index].value, values[index].range);
        } else {
          if (values.length !== 1) { observe(element, attribute, 'unsupported', 'schema-location-single'); continue; }
          admit(element, attribute, values[0].value, values[0].range, 'xsi-no-namespace-schema-location');
        }
        continue;
      }
      if (schemaLike && name.prefix && name.namespaceUri !== XSI) {
        observe(element, attribute, name.state === 'bound' ? 'ignored' : 'unsupported',
          name.state === 'bound' ? 'schema-attribute-other-namespace' : 'schema-attribute-prefix-unbound');
        continue;
      }
      const xsd = element.expandedName.namespaceUri === XSD && ['include', 'import'].includes(element.expandedName.localName);
      if (xsd && name.state === 'no-namespace' && name.localName === 'schemaLocation') {
        if (attribute.unresolved) { observe(element, attribute, 'unsupported', 'unresolved-reference-value'); continue; }
        const values = words(attribute);
        if (values.length !== 1) { observe(element, attribute, 'unsupported', 'schema-location-single'); continue; }
        admit(element, attribute, values[0].value, values[0].range, 'xsd-schema-location');
        continue;
      }
      // Preserve the established configuration heuristic, explicitly separate
      // from namespace-qualified XSD semantics and never as namespace authority.
      if (element.expandedName.namespaceUri === XSD || !/^(?:[^:]+:)?(?:include|import)$/iu.test(element.name)
        || !LEGACY_ATTRIBUTES.has(attribute.name.toLowerCase())) continue;
      if (attribute.unresolved) { observe(element, attribute, 'unsupported', 'unresolved-reference-value'); continue; }
      admit(element, attribute, attribute.value, attribute.valueRange, 'xml-config-heuristic');
    }
    return scope;
  };
  return Object.freeze({ opening, entries, observations,
    coverage: () => Object.freeze({ state: reasons.size ? 'partial' : 'complete', reasons: Object.freeze([...reasons].sort()),
      source: 'xml-lexical-reference-subset', namespaceProbes }) });
};
