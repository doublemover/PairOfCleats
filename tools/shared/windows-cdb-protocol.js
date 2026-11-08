export const WINDOWS_CDB_CHILD_CONTEXT = 'PAIROFCLEATS_WINDOWS_CDB_CHILD_CONTEXT';
export const WINDOWS_CDB_OUTPUT_BYTES = 1024 * 1024;
export const WINDOWS_CDB_CHILD_PHASES = Object.freeze(['child:initialized', 'sqlite:entry', 'sqlite:before-native-import',
  'sqlite:native-import-completed', 'sqlite:update-start', 'sqlite:update-completed']);
const exceptionCommands = '.exr -1;.ecxr;~* k;lmv;.dump /m /u native.dmp;q';
// No application path is interpolated into debugger command text. -cf also
// replaces ambient ntsd.ini; -noshell and -netsyms:no keep this local and scoped.
export const WINDOWS_CDB_COMMANDS = ['av', 'sov', 'ii', '0xc0000409'].map(
  event => `sxd -c2 "${exceptionCommands}" ${event}`
).concat('g', '').join('\n');
