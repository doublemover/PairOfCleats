import fs from 'node:fs/promises';
import path from 'node:path';

export const resolveConfigSchemaPath = (root = process.cwd()) => (
  path.join(root, 'docs', 'config', 'schema.json')
);

export const loadConfigSchema = async (root = process.cwd()) => {
  const schemaPath = resolveConfigSchemaPath(root);
  return JSON.parse(await fs.readFile(schemaPath, 'utf8'));
};

