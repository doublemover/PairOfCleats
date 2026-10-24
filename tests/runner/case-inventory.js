import fs from 'node:fs/promises';

/** A sidecar partitions a physical fixture into explicit process boundaries. */
export const readTestCaseInventory = async (filename) => {
  const inventory = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (inventory?.schemaVersion !== 1 || !Array.isArray(inventory.cases)
    || !inventory.cases.length || inventory.cases.length > 4096) {
    throw new Error(`Invalid test case inventory: ${filename}`);
  }
  const seen = new Set();
  for (const id of inventory.cases) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id) || seen.has(id)) {
      throw new Error(`Invalid or duplicate test case ID in ${filename}: ${id}`);
    }
    seen.add(id);
  }
  return inventory.cases;
};
