"""Run the actual native application on the inherited real PTY and witness restoration."""
import json
import pathlib
import subprocess
import sys
import termios

binary, directory, mode = sys.argv[1:]
directory = pathlib.Path(directory)
before = termios.tcgetattr(0)


def recorded_mode(mode):
    # termios control characters contain bytes on POSIX; retain their exact values.
    return mode[:6] + [[value.hex() if isinstance(value, bytes) else value for value in mode[6]]]


child = subprocess.Popen([binary], stderr=subprocess.PIPE)
with (directory / 'pids.jsonl').open('a') as stream:
    stream.write(json.dumps(dict(native=child.pid)) + '\n')
try:
    _, stderr = child.communicate(timeout=18)
    after = termios.tcgetattr(0)
    (directory / 'terminal-receipt.json').write_text(json.dumps(dict(
        mode=mode, exitCode=child.returncode, stderr=stderr.decode(),
        beforeInput=recorded_mode(before), afterInput=recorded_mode(after), terminalRestored=before == after)))
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
    # Cleanup cannot turn a failed restoration observation into a passing receipt.
    termios.tcsetattr(0, termios.TCSANOW, before)
