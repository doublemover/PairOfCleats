import { CALLABLE_PARAMETERS_VERSION, MAX_CALLABLE_PARAMETER_SLOTS as MAX_SLOTS,
  MAX_CALLABLE_ANNOTATION_TEXT as MAX_TEXT } from '../../contracts/callable-parameters.js';
const range = (start, end, length) => Number.isSafeInteger(start) && Number.isSafeInteger(end)
  && start >= 0 && end >= start && end <= length ? Object.freeze({ start, end }) : null;
const annotation = (text, span, present = false) => !span
  ? Object.freeze({ presence: present ? 'unavailable' : 'absent', state: present ? 'partial' : 'complete', text: null, range: null })
  : Object.freeze({ presence: 'present', state: span.end - span.start <= MAX_TEXT ? 'complete' : 'partial',
    text: span.end - span.start <= MAX_TEXT ? text.slice(span.start, span.end) : null, range: span });
const visibility = modifiers => modifiers.find(value => ['private', 'protected', 'public'].includes(value)) || null;

/** AST-derived callable facts never merge a display-signature guess. Slot
 * cardinality is independent of bounded retained type/name display metadata.
 */
const project = ({ text, parameters, describe, parser, role, declarationRange, bodyRange, language = 'typescript',
  returnRange, hasReturnAnnotation = false, modifiers = [], decorators = [], parseComplete = true }) => {
  const slots = [], params = [], paramTypes = Object.create(null);
  const known = Array.isArray(parameters);
  let runtimeSlotCount = 0, min = 0, variadic = false, arityKnown = known && parseComplete;
  for (let ordinal = 0; ordinal < (parameters?.length || 0); ordinal++) {
    const value = describe(parameters[ordinal], ordinal < MAX_SLOTS);
    const receiver = value.name === 'this';
    if (receiver && (ordinal !== 0 || value.optional || value.defaulted || value.rest)
      || value.rest && (ordinal !== parameters.length - 1 || value.optional || value.defaulted) || !value.known) arityKnown = false;
    const runtimeOrdinal = receiver ? null : runtimeSlotCount++;
    if (!receiver && value.rest) variadic = true;
    if (!receiver && !value.rest && !value.optional && !value.defaulted) min = runtimeOrdinal + 1;
    if (ordinal >= MAX_SLOTS) continue;
    const name = typeof value.name === 'string' && value.name.length <= MAX_TEXT ? value.name : null;
    const type = annotation(text, value.typeRange, value.hasType);
    slots.push(Object.freeze({ ordinal, runtimeOrdinal, role: receiver ? 'receiver' : 'runtime', name,
      namePresence: name ? 'present' : value.name ? 'unavailable' : 'pattern',
      binding: value.binding, optional: value.optional, defaulted: value.defaulted, rest: value.rest,
      range: value.range, bindingRange: value.bindingRange, type }));
    if (!receiver && name) {
      params.push(name);
      if (type.presence === 'present' && type.state === 'complete') paramTypes[name] = type.text;
    }
  }
  const formalSlotCount = known ? parameters.length : null;
  const returnAnnotation = annotation(text, returnRange, hasReturnAnnotation);
  const signatureRange = declarationRange ? range(declarationRange.start, bodyRange?.start ?? declarationRange.end, text.length) : null;
  const callableParameters = Object.freeze({ schemaVersion: CALLABLE_PARAMETERS_VERSION, language, parser, role,
    presence: known ? 'known' : 'unavailable', state: parseComplete && known ? 'complete' : 'partial',
    declarationRange, signatureRange, signaturePreviewTruncated: Boolean(signatureRange && signatureRange.end - signatureRange.start > MAX_TEXT),
    bodyRange, formalSlotCount, runtimeSlotCount: known ? runtimeSlotCount : null,
    retainedSlots: slots.length, omittedSlots: known ? parameters.length - slots.length : null,
    slotCoverage: known && parameters.length === slots.length ? 'complete' : 'partial', slots: Object.freeze(slots),
    arity: Object.freeze({ state: arityKnown ? 'complete' : 'unavailable', min: arityKnown ? min : null,
      max: arityKnown && !variadic ? runtimeSlotCount : null, variadic: arityKnown ? variadic : null }), returnAnnotation });
  return { params, paramTypes, returns: returnAnnotation.text, callableParameters,
    modifiers, visibility: visibility(modifiers), attributes: decorators };
};

export const projectCompilerCallable = ({ ts, node, sourceFile, text, start, end }) => {
  const span = value => value ? range(value.getStart(sourceFile), value.end, text.length) : null;
  const constructor = ts.isConstructorDeclaration(node);
  const role = constructor ? 'constructor' : ts.isGetAccessorDeclaration(node) ? 'getter'
    : ts.isSetAccessorDeclaration(node) ? 'setter' : ts.isArrowFunction(node) ? 'arrow' : 'function';
  const modifiers = (ts.getModifiers?.(node) || []).slice(0, 64).map(value => value.getText(sourceFile));
  const decorators = (ts.getDecorators?.(node) || []).slice(0, 64).map(value => value.getText(sourceFile).slice(0, MAX_TEXT));
  return project({ text, parameters: node.parameters, parser: 'typescript-compiler', role,
    declarationRange: range(start, end, text.length), bodyRange: span(node.body), returnRange: constructor ? null : span(node.type),
    hasReturnAnnotation: !constructor && Boolean(node.type),
    modifiers, decorators, parseComplete: !sourceFile.parseDiagnostics?.length,
    describe: (parameter, retain) => ({ known: ts.isParameter(parameter), name: ts.isIdentifier(parameter.name) ? parameter.name.text : null,
      binding: ts.isIdentifier(parameter.name) ? 'identifier' : ts.isObjectBindingPattern(parameter.name) ? 'object-pattern'
        : ts.isArrayBindingPattern(parameter.name) ? 'array-pattern' : 'unknown',
      optional: Boolean(parameter.questionToken), defaulted: Boolean(parameter.initializer), rest: Boolean(parameter.dotDotDotToken),
      range: retain ? span(parameter) : null, bindingRange: retain ? span(parameter.name) : null,
      hasType: Boolean(parameter.type), typeRange: retain ? span(parameter.type) : null }) });
};

export const projectBabelCallable = ({ node, text, start, end, parseComplete = true, language = 'typescript', parser = 'typescript-babel' }) => {
  const span = value => value ? range(value.start, value.end, text.length) : null;
  const role = node.kind === 'constructor' ? 'constructor' : node.kind === 'get' ? 'getter'
    : node.kind === 'set' ? 'setter' : node.type === 'ArrowFunctionExpression' ? 'arrow' : 'function';
  const modifiers = ['abstract', 'static', 'async', 'generator', 'declare', 'readonly', 'override']
    .filter(key => node[key] === true);
  if (node.accessibility) modifiers.push(node.accessibility);
  return project({ text, parameters: node.params || node.parameters, parser, language, role,
    declarationRange: range(start, end, text.length), bodyRange: span(node.body),
    returnRange: role === 'constructor' ? null : span(node.returnType?.typeAnnotation || node.typeAnnotation?.typeAnnotation),
    hasReturnAnnotation: role !== 'constructor' && Boolean(node.returnType || node.typeAnnotation),
    modifiers, decorators: (node.decorators || []).slice(0, 64).map(value => text.slice(value.start, Math.min(value.end, value.start + MAX_TEXT))), parseComplete,
    describe: (parameter, retain) => {
      const original = parameter;
      if (parameter.type === 'TSParameterProperty') parameter = parameter.parameter;
      const defaulted = parameter.type === 'AssignmentPattern';
      if (defaulted) parameter = parameter.left;
      const rest = parameter.type === 'RestElement';
      const binding = rest ? parameter.argument : parameter;
      const type = parameter.typeAnnotation?.typeAnnotation || binding.typeAnnotation?.typeAnnotation;
      return { known: ['Identifier', 'ObjectPattern', 'ArrayPattern'].includes(binding.type),
        name: binding.type === 'Identifier' ? binding.name : null,
        binding: binding.type === 'Identifier' ? 'identifier' : binding.type === 'ObjectPattern' ? 'object-pattern'
          : binding.type === 'ArrayPattern' ? 'array-pattern' : 'unknown',
        optional: parameter.optional === true || binding.optional === true, defaulted, rest,
        range: retain ? span(original) : null, bindingRange: retain ? span(binding) : null, hasType: Boolean(type), typeRange: retain ? span(type) : null };
    } });
};
