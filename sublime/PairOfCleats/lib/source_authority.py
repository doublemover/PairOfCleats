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
    return {'repoRoot': root, 'file': real, 'sourceHash': hashlib.sha256(raw).hexdigest(),
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


def source_buffer_form(source_text, buffer_text):
    """Choose only a fully observed exact BOM/newline projection."""
    bom_options = (False, True) if source_text.startswith('\ufeff') else (False,)
    for removed_bom in bom_options:
        text = source_text[1:] if removed_bom else source_text
        if buffer_text in (text, re.sub(r'\r(?!\n)', '\n', text)):
            return {'removedBom': removed_bom, 'collapsedCrLf': False}
        normalized = text.replace('\r\n', '\n')
        if buffer_text in (normalized, normalized.replace('\r', '\n')):
            return {'removedBom': removed_bom, 'collapsedCrLf': True}
    return None


def source_cursor_position(source_text, buffer_text, point):
    """Invert the observed buffer projection before deriving protocol position."""
    if (not isinstance(point, int) or isinstance(point, bool) or point < 0 or point > len(buffer_text)):
        raise ValueError('Current cursor is outside the qualified source buffer.')
    form = source_buffer_form(source_text, buffer_text)
    if form is None:
        raise ValueError('Source buffer differs beyond supported BOM/newline normalization.')
    original = 1 if form['removedBom'] else 0
    visited = 0
    while visited < point:
        width = 2 if form['collapsedCrLf'] and source_text[original:original + 2] == '\r\n' else 1
        original += width
        visited += 1
    if source_text[max(0, original - 1):original + 1] == '\r\n':
        raise ValueError('Current cursor intersects a CRLF line ending.')
    offset = len(source_text[:original].encode('utf-16-le')) // 2
    return utf16_source_position(source_text, offset)


def _protocol_source_points(text, source_range):
    starts, ends = [0], []
    index = 0
    while index < len(text):
        if text[index] in ('\r', '\n'):
            ends.append(index)
            if text[index:index + 2] == '\r\n':
                index += 1
            starts.append(index + 1)
        index += 1
    ends.append(len(text))

    def at(line, column):
        if (not isinstance(line, int) or isinstance(line, bool) or not 1 <= line <= len(starts)
                or not isinstance(column, int) or isinstance(column, bool) or column < 1):
            raise ValueError('Indexed line/column is outside the qualified source.')
        encoded = text[starts[line - 1]:ends[line - 1]].encode('utf-16-le')
        if (column - 1) * 2 > len(encoded):
            raise ValueError('Indexed column exceeds its qualified source line.')
        # Strict decoding rejects a boundary inside an astral surrogate pair.
        return starts[line - 1] + len(encoded[:(column - 1) * 2].decode('utf-16-le'))

    start = at(source_range.get('startLine'), source_range.get('startCol'))
    end = at(source_range.get('endLine'), source_range.get('endCol'))
    if end < start:
        raise ValueError('Indexed source range ends before it begins.')
    return start, end


def source_range_in_buffer(source, buffer_text, source_range):
    """Original verified UTF-16 range to the actually observed buffer points."""
    text = source['sourceText']
    form = source_buffer_form(text, buffer_text)
    if form is None:
        raise ValueError('Opened target text differs beyond supported BOM/newline normalization.')
    start, end = _protocol_source_points(text, source_range)
    bom = 1 if form['removedBom'] else 0

    def mapped(point):
        if point < bom or text[max(0, point - 1):point + 1] == '\r\n':
            raise ValueError('Indexed boundary intersects a removed BOM or splits a CRLF line ending.')
        return point - bom - (text[:point].count('\r\n') if form['collapsedCrLf'] else 0)

    return {'start': mapped(start), 'end': mapped(end), 'originalSource': {
        'file': os.path.relpath(source['file'], source['repoRoot']).replace(os.sep, '/'),
        'contentDigest': source['sourceHash'], 'byteLength': source['byteLength'],
        'span': {'start': len(text[:start].encode('utf-8')), 'end': len(text[:end].encode('utf-8')), 'unit': 'utf8-byte'}}}
