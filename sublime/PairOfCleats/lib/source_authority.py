"""Bounded original-byte authority for editor source opening, never a resolver."""
import hashlib
import os
import re

MAX_SOURCE_BYTES = 4194304


def _signature(stat):
    return (stat.st_dev, stat.st_ino, stat.st_size,
            getattr(stat, 'st_mtime_ns', stat.st_mtime), getattr(stat, 'st_ctime_ns', stat.st_ctime))


def read_verified_source(repo_root, filename, source_hash):
    if not isinstance(source_hash, str) or not re.match(r'^[a-f0-9]{64}\Z', source_hash):
        raise ValueError('Exact original-byte source hash is required.')
    root = os.path.realpath(repo_root)
    real = os.path.realpath(filename)
    relative = os.path.relpath(real, root)
    if relative == os.pardir or relative.startswith(os.pardir + os.sep) or os.path.isabs(relative):
        raise ValueError('Source resolves outside the selected repository.')
    with open(real, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if before.st_size > MAX_SOURCE_BYTES:
            raise ValueError('Source exceeds the 4 MiB editor verifier.')
        raw = handle.read(min(before.st_size + 1, MAX_SOURCE_BYTES + 1))
        after = os.fstat(handle.fileno())
    current = os.stat(real)
    if (len(raw) != before.st_size or _signature(before) != _signature(after)
            or _signature(current) != _signature(after) or os.path.realpath(filename) != real):
        raise ValueError('Source changed while its exact bytes were being verified.')
    if hashlib.sha256(raw).hexdigest() != source_hash:
        raise ValueError('Source differs from indexed evidence.')
    return {'file': real, 'sourceHash': source_hash, 'sourceText': raw.decode('utf-8')}
