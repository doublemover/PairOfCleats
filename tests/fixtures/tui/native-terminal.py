"""Run the actual native application on the inherited real PTY and witness restoration."""
import json
import pathlib
import subprocess
import sys
import termios

binary, directory, mode = sys.argv[1:]
directory = pathlib.Path(directory)
before = termios.tcgetattr(0)
child = subprocess.Popen([binary], stderr=subprocess.PIPE)
with (directory / 'pids.jsonl').open('a') as stream:
    stream.write(json.dumps(dict(native=child.pid)) + '\n')
try:
    _, stderr = child.communicate(timeout=18)
    after = termios.tcgetattr(0)
    (directory / 'terminal-receipt.json').write_text(json.dumps(dict(
        mode=mode, exitCode=child.returncode, stderr=stderr.decode(),
        beforeInput=before, afterInput=after, terminalRestored=before == after)))
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
    # Cleanup cannot turn a failed restoration observation into a passing receipt.
    termios.tcsetattr(0, termios.TCSANOW, before)
