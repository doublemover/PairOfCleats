import fs from 'node:fs';
if (process.env.PAIROFCLEATS_TESTING !== '1') throw new Error('Inert receipt transport requires the test environment.');
process.stdout.write(fs.readFileSync(process.argv[2], 'utf8'));
