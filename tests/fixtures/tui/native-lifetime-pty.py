"""Actual native binary and real supervisor: no simulated lifecycle backend."""
import errno
import json
import os
import pathlib
import pty
import select
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time
import fcntl

root, node, mode = sys.argv[1:]
binary = pathlib.Path(root) / 'crates/pairofcleats-tui/target/debug/pairofcleats-tui'
if not binary.is_file():
    raise RuntimeError('Native qualification requires cargo build --locked before fixture execution')
if not sys.platform.startswith('linux'):
    raise RuntimeError('This real /proc descendant qualification requires Linux; other platforms need native receipts')
with tempfile.TemporaryDirectory(prefix='poc-native-lifetime-') as directory:
    receipt = pathlib.Path(directory) / 'pids.jsonl'
    snapshot = pathlib.Path(directory) / 'state.json'
    (pathlib.Path(directory) / 'fixture-mode.json').write_text(json.dumps(mode))
    input_master, input_slave = pty.openpty()
    output_master, output_slave = pty.openpty()
    for fd in [input_slave, output_slave]:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 140, 0, 0))
    original = termios.tcgetattr(input_slave)
    env = dict(os.environ, TERM='xterm-256color', PAIROFCLEATS_TUI_NODE=node,
               PAIROFCLEATS_TUI_SUPERVISOR=str(pathlib.Path(root) / 'tests/fixtures/tui/native-lifetime-supervisor.js'),
               PAIROFCLEATS_TUI_SNAPSHOT_PATH=str(snapshot), PAIROFCLEATS_TUI_EVENT_LOG_DIR=directory)
    def acquire_terminal():
        os.setsid()
        fcntl.ioctl(input_slave, termios.TIOCSCTTY, 0)

    child = subprocess.Popen([str(binary)], cwd=root, env=env, stdin=input_slave,
                             stdout=output_slave, stderr=subprocess.PIPE, preexec_fn=acquire_terminal)
    rows = []
    output_open = True
    terminal_tail = [b'']
    terminal_output = [b'']

    def drain():
        if output_open and select.select([output_master], [], [], 0)[0]:
            try:
                chunk = os.read(output_master, 65536)
                terminal_output[0] = (terminal_output[0] + chunk)[-32768:]
                wire = terminal_tail[0] + chunk
                # A real PTY needs a terminal emulator's standard DSR response.
                # Only terminal wire negotiation is emulated; UI, jobs, and
                # supervisor lifecycle all execute the native production code.
                for _ in range(wire.count(b'\x1b[6n')):
                    os.write(input_master, b'\x1b[1;1R')
                terminal_tail[0] = wire[-3:]
            except OSError as error:
                if error.errno != errno.EIO:
                    raise

    def wait_until(predicate, seconds=12, require_alive=True):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            drain()
            if predicate():
                return
            if require_alive and child.poll() is not None:
                raise AssertionError('Native binary exited before witness: ' + child.stderr.read().decode())
            time.sleep(0.02)
        raise AssertionError('native lifecycle witness timed out')

    def read_rows():
        return [json.loads(line) for line in receipt.read_text().splitlines()] if receipt.exists() else []

    def search_overlay_ready():
        if not terminal_output[0]:
            return False
        module_url = (pathlib.Path(root) / 'tools/testing/terminal-screen.js').as_uri()
        script = ('import { reconstructTerminalScreen } from ' + json.dumps(module_url) + ';'
                  'import { readFileSync } from "node:fs";'
                  'process.stdout.write(reconstructTerminalScreen(readFileSync(0, "utf8"),'
                  '{ columns: 140, rows: 40 }).text);')
        rendered = subprocess.run([node, '--input-type=module', '-e', script], input=terminal_output[0],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=1, check=True)
        return b'Type to filter' in rendered.stdout

    try:
        wait_until(lambda: receipt.exists())
        os.write(input_master, b'r')
        wait_until(lambda: any('descendant' in row for row in read_rows()))
        rows = read_rows()
        if mode == 'quit':
            os.write(input_master, b'q')
        elif mode == 'interrupt':
            terminal_output[0] = b''
            os.write(input_master, b'/')
            wait_until(search_overlay_ready, 2)
            os.write(input_master, b'\x03\x03')
        elif mode == 'terminal-error':
            os.close(output_master)
            output_open = False
        wait_until(lambda: child.poll() is not None, 14)
        code = child.wait()
        if mode in ('quit', 'interrupt'):
            assert code == 0, child.stderr.read().decode()
        elif mode == 'supervisor-error':
            assert code != 0, 'unexpected supervisor failure must propagate to the native exit status'
            assert 'supervisor exited before TUI shutdown' in child.stderr.read().decode()
        elif mode == 'terminal-error':
            assert code != 0, 'closed real output terminal must exercise the error return'
        assert termios.tcgetattr(input_slave) == original, 'raw terminal settings must be restored'
        pids = {value for row in rows for key, value in row.items()
                if key in ('proxy', 'supervisor', 'job', 'descendant')}
        wait_until(lambda: all(not pathlib.Path('/proc/' + str(pid)).exists() for pid in pids), 2, require_alive=False)
        state = json.loads(snapshot.read_text())
        statuses = list(state['final_job_statuses'].values())
        if mode == 'interrupt':
            requests = [row.get('request') for row in read_rows()]
            assert requests.count('eof') == 1, 'Ctrl+C must use the existing single graceful supervisor EOF'
            assert 'job:cancel' not in requests, 'Ctrl+C cannot submit selected-job cancellation'
        assert statuses and all(status in ('cancelled', 'failed', 'done') for status in statuses), state
        if mode != 'supervisor-error':
            assert statuses == ['cancelled'], state
        print(json.dumps(dict(mode=mode, exitCode=code, ownedPids=sorted(pids),
                              allReaped=True, terminalRestored=True, finalStatuses=statuses)))
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
        for row in read_rows():
            for key, pid in row.items():
                if key in ('proxy', 'supervisor', 'job', 'descendant'):
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
        os.close(input_master)
        os.close(input_slave)
        os.close(output_slave)
        if output_open:
            os.close(output_master)
