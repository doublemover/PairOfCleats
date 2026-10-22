"""Bounded original-byte authority for editor source opening, never a resolver."""
import hashlib
import os
import re
import stat

MAX_SOURCE_BYTES = 4194304


def _signature(stat):
    return (stat.st_dev, stat.st_ino, stat.st_size,
            getattr(stat, 'st_mtime_ns', stat.st_mtime), getattr(stat, 'st_ctime_ns', stat.st_ctime))


def read_current_source(repo_root, filename):
    if not isinstance(repo_root, str) or not repo_root or not isinstance(filename, str) or not filename:
        raise ValueError('Exact source file and repository are required.')
    root = os.path.realpath(repo_root)
    real = os.path.realpath(filename)
    relative = os.path.relpath(real, root)
    if relative == os.pardir or relative.startswith(os.pardir + os.sep) or os.path.isabs(relative):
        raise ValueError('Source resolves outside the selected repository.')
    with open(real, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_SOURCE_BYTES:
            raise ValueError('Source is not a regular file within the 4 MiB editor verifier.')
        raw = handle.read(min(before.st_size + 1, MAX_SOURCE_BYTES + 1))
        after = os.fstat(handle.fileno())
    current = os.stat(real)
    if (len(raw) != before.st_size or _signature(before) != _signature(after)
            or _signature(current) != _signature(after) or os.path.realpath(filename) != real):
        raise ValueError('Source changed while its exact bytes were being verified.')
    return {'file': real, 'sourceHash': hashlib.sha256(raw).hexdigest(),
            'sourceText': raw.decode('utf-8'), 'byteLength': len(raw)}


def read_verified_source(repo_root, filename, source_hash):
    if not isinstance(source_hash, str) or not re.match(r'^[a-f0-9]{64}\Z', source_hash):
        raise ValueError('Exact original-byte source hash is required.')
    source = read_current_source(repo_root, filename)
    if source['sourceHash'] != source_hash:
        raise ValueError('Source differs from indexed evidence.')
    return source


def utf16_source_position(text, offset):
    """One-based protocol position in original UTF-16, with CR/LF/CRLF lines."""
    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
        raise ValueError('Record has no exact UTF-16 source offset.')
    encoded = text.encode('utf-16-le')
    if offset * 2 > len(encoded):
        raise ValueError('Record span exceeds its qualified source.')
    if encoded[max(0, offset * 2 - 2):offset * 2 + 2] == b'\r\x00\n\x00':
        raise ValueError('Record boundary intersects a CRLF line ending.')
    # Strict decoding rejects an offset inside an astral surrogate pair.
    before = encoded[:offset * 2].decode('utf-16-le')
    line, start, index = 1, 0, 0
    while index < len(before):
        if before[index] in ('\r', '\n'):
            if before[index] == '\r' and index + 1 < len(before) and before[index + 1] == '\n':
                index += 1
            line += 1
            start = index + 1
        index += 1
    return line, len(before[start:].encode('utf-16-le')) // 2 + 1
