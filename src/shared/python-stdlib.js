// Public Python standard-library roots, including supported legacy spellings.
// Unknown third-party roots retain package attribution.
const PYTHON_STDLIB_ROOTS = new Set(`
__future__ abc aifc antigravity argparse array ast asynchat asyncio asyncore
atexit audioop base64 bdb binascii bisect builtins bz2 calendar cgi cgitb chunk
cmath cmd code codecs codeop collections colorsys compileall concurrent configparser
contextlib contextvars copy copyreg cProfile crypt csv ctypes curses dataclasses
datetime dbm decimal difflib dis distutils doctest email encodings ensurepip enum
errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc
getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http idlelib
imaplib imghdr imp importlib inspect io ipaddress itertools json keyword lib2to3
linecache locale logging lzma mailbox mailcap marshal math mimetypes mmap modulefinder
msilib msvcrt multiprocessing netrc nis nntplib numbers operator optparse os ossaudiodev
pathlib pdb pickle pickletools pipes pkgutil platform plistlib poplib posix posixpath
pprint profile pstats pty pwd py_compile pyclbr pydoc queue quopri random re readline
reprlib resource rlcompleter runpy sched secrets select selectors shelve shlex shutil
signal site smtpd smtplib sndhdr socket socketserver spwd sqlite3 sre_compile sre_constants
sre_parse ssl stat statistics string stringprep struct subprocess sunau symtable sys
sysconfig syslog tabnanny tarfile telnetlib tempfile termios test textwrap threading
time timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle
turtledemo types typing unicodedata unittest urllib uu uuid venv warnings wave weakref
webbrowser winreg winsound wsgiref xdrlib xml xmlrpc zipapp zipfile zipimport zlib zoneinfo
`.split(/\s+/).filter(Boolean));

export const isPythonStandardLibraryImport = specifier => {
  if (typeof specifier !== 'string' || !specifier || specifier.startsWith('.')) return false;
  const root = specifier.split('.')[0];
  return PYTHON_STDLIB_ROOTS.has(root);
};
