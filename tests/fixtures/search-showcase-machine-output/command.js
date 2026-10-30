const mode = process.argv[2];
if (mode === 'empty') process.exitCode = 1;
else {
  process.stdout.write(mode === 'human' ? 'ordinary human output\n' : '{"ok":true}\n');
  if (mode === 'trailing') process.stdout.write('warning on stdout\n');
  if (mode === 'diagnostic') process.stderr.write('expected diagnostic on stderr\n');
  if (mode === 'negative') process.exitCode = 3;
}
