"""Canonical indexed-metadata page admission; ranked text remains top-k."""
import re
import hashlib

MAX_HITS = 2000


class _FilterPageHits(list):
    """Private progress receipt, deliberately absent from project JSON."""

    def __init__(self, values, generation, cursors, matching_total=None):
        super().__init__(values)
        self.generation = generation
        self.cursor_digests = frozenset(cursors)
        self.matching_total = matching_total


def carry_filter_page_history(original, normalized):
    if type(original) is _FilterPageHits and isinstance(normalized, list):
        return _FilterPageHits(normalized, original.generation, original.cursor_digests, original.matching_total)
    return normalized


def has_filter_page_history(hits):
    return type(hits) is _FilterPageHits


def _cursor_digest(cursor):
    return hashlib.sha256(cursor.encode('utf-8')).hexdigest()


def _count(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 9007199254740991 else None


def normalize_filter_pagination(value):
    if (not isinstance(value, dict) or value.get('kind') != 'filter'
            or not isinstance(value.get('generation'), str)
            or not re.match(r'^[a-f0-9]{64}\Z', value['generation'])
            or not isinstance(value.get('hasMore'), bool)
            or value.get('order') not in (None, 'indexed-order')
            or not value['hasMore'] and value.get('nextCursor') is not None):
        return None
    cursor = value.get('nextCursor')
    if value['hasMore'] and (not isinstance(cursor, str) or not 0 < len(cursor) <= 8192):
        return None
    return {'kind': 'filter', 'order': 'indexed-order', 'generation': value['generation'],
        'total': _count(value.get('total')), 'returned': _count(value.get('returned')) or 0,
        'hasMore': value.get('hasMore') is True,
        'nextCursor': cursor if isinstance(cursor, str) and 0 < len(cursor) <= 8192 else None,
        'coverage': value.get('coverage') or 'indexed-metadata',
        'coverageNote': str(value.get('coverageNote') or '')[:4096]}


def admit_filter_page(value, hits, first_page=False):
    page = normalize_filter_pagination(value)
    if (not page or not isinstance(hits, list) or len(hits) > MAX_HITS
            or _count(value.get('returned')) != len(hits)
            or page['total'] is not None and page['total'] < page['returned']
            or page['hasMore'] and page['returned'] == 0
            or page['hasMore'] and page['total'] is not None and page['returned'] >= page['total']
            or first_page and not page['hasMore'] and page['total'] is not None and page['returned'] != page['total']):
        raise ValueError('Indexed browsing returned invalid generation/page membership. Restart with supported indexed metadata filters.')
    return page


def hit_identity(hit):
    chunk = hit.get('chunkUid')
    if isinstance(chunk, str) and chunk:
        return (hit.get('section'), 'chunkUid', chunk)
    value = hit.get('id')
    if isinstance(value, str) and value:
        return (hit.get('section'), 'string-id', value)
    if _count(value) is not None:
        return (hit.get('section'), 'number-id', value)
    return None


def merge_filter_page(previous_session, next_pagination, hits):
    previous = normalize_filter_pagination(previous_session.get('pagination'))
    current = normalize_filter_pagination(next_pagination)
    if not previous or not current or previous['generation'] != current['generation']:
        raise ValueError('Indexed generation changed or page identity is unavailable. Restart Browse Indexed Matches.')
    current = admit_filter_page(next_pagination, hits)
    if previous['total'] is not None and current['total'] is not None and previous['total'] != current['total']:
        raise ValueError('Indexed matching total changed within one generation. Restart browsing; the previous result set is retained.')
    if current['hasMore'] and current['nextCursor'] == previous['nextCursor']:
        raise ValueError('Indexed continuation did not advance. Restart browsing; the previous result set is retained.')
    original = previous_session.get('hits') or []
    retained_total = original.matching_total if type(original) is _FilterPageHits else None
    if retained_total is not None and (previous['total'] is not None and previous['total'] != retained_total
            or current['total'] is not None and current['total'] != retained_total):
        raise ValueError('Indexed matching total differs from its original page receipt. Restart browsing; previous evidence is retained.')
    cursors = set(original.cursor_digests) if type(original) is _FilterPageHits and original.generation == current['generation'] else set()
    if isinstance(previous['nextCursor'], str):
        cursors.add(_cursor_digest(previous['nextCursor']))
    if current['hasMore'] and _cursor_digest(current['nextCursor']) in cursors:
        raise ValueError('Indexed continuation repeated an earlier cursor. Restart browsing; the previous result set is retained.')
    merged = list(original)
    seen = set(hit_identity(hit) for hit in merged if hit_identity(hit) is not None)
    for hit in hits:
        identity = hit_identity(hit)
        if identity is None or identity not in seen:
            merged.append(hit)
            if identity is not None:
                seen.add(identity)
    if current['hasMore'] and len(merged) == len(original):
        raise ValueError('Indexed continuation returned no new source identities. Restart browsing; the previous result set is retained.')
    if len(merged) > MAX_HITS:
        raise ValueError('View reached its 2,000 hit bound. Narrow filters and restart.')
    total = current['total'] if current['total'] is not None else previous['total']
    if total is None:
        total = retained_total
    if total is not None and len(merged) > total:
        raise ValueError('Indexed loaded membership exceeds its captured matching total. Restart browsing; the previous result set is retained.')
    if total is not None and (current['hasMore'] and len(merged) == total
            or not current['hasMore'] and len(merged) != total):
        raise ValueError('Indexed continuation exhaustion contradicts its captured matching total. Restart browsing; previous evidence is retained.')
    if current['hasMore']:
        cursors.add(_cursor_digest(current['nextCursor']))
    return _FilterPageHits(merged, current['generation'], cursors, total)


def selected_index(session, hits):
    selected = session.get('selectedIdentity')
    if isinstance(selected, (list, tuple)) and len(selected) == 3:
        for index, hit in enumerate(hits):
            identity = hit_identity(hit)
            if identity is not None and list(identity) == list(selected):
                return index
    ordinal = session.get('selectedOrdinal')
    return ordinal if isinstance(ordinal, int) and not isinstance(ordinal, bool) and 0 <= ordinal < len(hits) else -1


def capture_selection(session, hits, index):
    if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(hits):
        return
    identity = hit_identity(hits[index])
    session['selectedIdentity'] = list(identity) if identity is not None else None
    session['selectedOrdinal'] = index


def continuation_endpoint_matches(session, execution):
    if session.get('transport') != execution.get('mode'):
        return False
    if session.get('transport') == 'api':
        return bool(session.get('endpoint')) and session['endpoint'] == execution.get('base_url')
    return session.get('transport') == 'cli'
