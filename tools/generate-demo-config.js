#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import { parseJsoncText } from '../src/shared/jsonc.js';
import { DEFAULT_USER_CONFIG_TEMPLATE } from './default-config-template.js';

const argv = createCli({
  scriptName: 'generate-demo-config',
  options: {
    schema: { type: 'string', default: 'docs/config-schema.json' },
    out: { type: 'string', default: 'demo.pairofcleats.json' }
  }
}).parse();

const schemaPath = path.resolve(argv.schema);
const outPath = path.resolve(argv.out);
const schemaRaw = await fs.readFile(schemaPath, 'utf8');
const schema = JSON.parse(schemaRaw);
const templateDefaults = parseJsoncText(DEFAULT_USER_CONFIG_TEMPLATE, 'default-config-template');

const collectTypes = (node) => {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node.type)) return node.type;
  if (typeof node.type === 'string') return [node.type];
  const options = node.oneOf || node.anyOf || [];
  const nested = [];
  for (const option of options) {
    nested.push(...collectTypes(option));
  }
  return Array.from(new Set(nested));
};

const collectEnum = (node) => {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node.enum)) return node.enum.slice();
  if (node.const !== undefined) return [node.const];
  const options = node.oneOf || node.anyOf || [];
  const values = [];
  for (const option of options) {
    values.push(...collectEnum(option));
  }
  return Array.from(new Set(values));
};

const resolveDefault = (node) => {
  if (!node || typeof node !== 'object') return { value: null, hasDefault: false };
  if (node.default !== undefined) return { value: node.default, hasDefault: true };
  if (node.const !== undefined) return { value: node.const, hasDefault: true };
  const types = collectTypes(node);
  if (types.includes('array')) return { value: [], hasDefault: false };
  return { value: null, hasDefault: false };
};

const formatValue = (value) => {
  return JSON.stringify(value);
};

const describeAcceptedValues = (node) => {
  const enumValues = collectEnum(node);
  if (enumValues.length) {
    return `Accepted values: ${enumValues.map(formatValue).join(', ')}`;
  }
  const types = collectTypes(node);
  if (types.includes('boolean')) {
    return 'Accepted values: true, false';
  }
  const itemEnums = collectEnum(node?.items);
  if (itemEnums.length) {
    return `Accepted values (items): ${itemEnums.map(formatValue).join(', ')}`;
  }
  return '';
};

const describeDefault = (node, hasDefault, value, templateValue) => {
  if (templateValue !== undefined) return `Default: ${formatValue(templateValue)}`;
  if (hasDefault) return `Default: ${formatValue(value)}`;
  if (node && node.default !== undefined) return `Default: ${formatValue(node.default)}`;
  return '';
};

const describeMax = (node) => {
  if (!node || typeof node !== 'object') return '';
  if (Number.isFinite(node.maximum)) return `Max: ${node.maximum}`;
  if (Number.isFinite(node.maxItems)) return `Max items: ${node.maxItems}`;
  if (Number.isFinite(node.maxLength)) return `Max length: ${node.maxLength}`;
  if (Number.isFinite(node.maxProperties)) return `Max properties: ${node.maxProperties}`;
  return '';
};

const renderProperties = (node, lines, indent, pathPrefix, templateNode) => {
  const properties = node?.properties && typeof node.properties === 'object'
    ? node.properties
    : {};
  const keys = Object.keys(properties);
  keys.forEach((key, index) => {
    const prop = properties[key];
    const propPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    const { value, hasDefault } = resolveDefault(prop);
    const templateValue = templateNode && typeof templateNode === 'object'
      ? templateNode[key]
      : undefined;
    const types = collectTypes(prop);
    const accepted = describeAcceptedValues(prop);
    if (accepted) lines.push(`${indent}// ${accepted}`);
    const defaultLine = describeDefault(prop, hasDefault, value, templateValue);
    if (defaultLine) lines.push(`${indent}// ${defaultLine}`);
    const maxLine = describeMax(prop);
    if (maxLine) lines.push(`${indent}// ${maxLine}`);

    const isObject = types.includes('object') && prop?.properties && typeof prop.properties === 'object';
    const isLeafObject = types.includes('object') && !prop?.properties;
    const comma = index < keys.length - 1 ? ',' : '';
    if (isObject) {
      lines.push(`${indent}"${key}": {`);
      renderProperties(prop, lines, `${indent}  `, propPath, templateValue);
      lines.push(`${indent}}${comma}`);
    } else if (isLeafObject && hasDefault && typeof value === 'object') {
      lines.push(`${indent}"${key}": ${JSON.stringify(value, null, 2)}${comma}`);
    } else {
      const outputValue = templateValue !== undefined ? templateValue : value;
      lines.push(`${indent}"${key}": ${formatValue(outputValue)}${comma}`);
    }
  });
};

const lines = [];
lines.push('{');
renderProperties(schema, lines, '  ', '', templateDefaults);
lines.push('}');
lines.push('');

await fs.writeFile(outPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${outPath}`);
