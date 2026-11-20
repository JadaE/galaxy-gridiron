#!/usr/bin/env python3
"""Name-free tests for the family live schema overlay. No collection names, passwords, hashes, or keys."""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from leaderboard import apply_live_tag_schema, LIVE_SCHEMA_PATH, validate_record  # noqa: E402

# Current published live field set (no names): required season, week, picks; no typ/tags/league/at.
OLD_LIVE_FIELDS = {
    'uid': {'type': 'string', 'maxLength': 24, 'required': True, 'trim': True},
    'un': {'type': 'string', 'maxLength': 40, 'required': True, 'trim': True},
    'av': {'type': 'string', 'maxLength': 64, 'trim': True},
    'season': {'type': 'integer', 'minimum': 2020, 'maximum': 2100, 'required': True},
    'week': {'type': 'integer', 'minimum': 1, 'maximum': 23, 'required': True},
    'picks': {'type': 'object', 'required': True},
    'bf': {'type': 'object'},
    'ts': {'type': 'number', 'minimum': 0, 'required': True},
    'app': {'type': 'string', 'maxLength': 16},
}

PICK = {
    'app': 'gg', 'uid': '1000000000000000101', 'un': 'mockusera',
    'season': 2026, 'week': 7, 'picks': {'401873010': 'CHI'}, 'ts': 1,
}
TAG = {
    'app': 'gg', 'typ': 'tags', 'uid': '1000000000000000101', 'un': 'mockusera',
    'league': '999000111222', 'tags': {'1001': 'never'}, 'at': {'1001': 1000}, 'ts': 1000,
}

pass_n = fail_n = 0

def t(name, fn):
    global pass_n, fail_n
    try:
        fn(); pass_n += 1; print('  ok', name)
    except Exception as e:
        fail_n += 1; print('  FAIL', name, ':', e)


def test_template_is_name_free():
    raw = open(LIVE_SCHEMA_PATH).read()
    assert 'gg' + 'a' * 40 not in raw
    # no private-looking hex ids or password wording as values
    tmpl = json.loads(raw)
    assert set(tmpl['add_fields']) == {'typ', 'tags', 'league', 'at'}
    assert tmpl['make_optional'] == ['season', 'week', 'picks']


def test_overlay_and_existing_picks_still_validate():
    live = {'access': {'read': 'public', 'insert': 'public'}, 'fields': json.loads(json.dumps(OLD_LIVE_FIELDS)), 'rateLimit': '120/hour/ip'}
    apply_live_tag_schema(live)
    f = live['fields']
    for k in ('typ', 'tags', 'league', 'at'):
        assert k in f, k
    for k in ('season', 'week', 'picks'):
        assert k in f and not f[k].get('required'), k
    # archive-like required flags must not leak: this object is the live copy only
    assert validate_record(f, PICK) is None
    assert validate_record(f, TAG) is None
    # old schema would reject a typ:tags record that omits season/week/picks
    assert validate_record(OLD_LIVE_FIELDS, TAG) == 'missing season'


def test_old_schema_still_accepts_picks():
    assert validate_record(OLD_LIVE_FIELDS, PICK) is None


if __name__ == '__main__':
    print('Family live schema overlay')
    t('template is name-free and lists typ, tags, league, at', test_template_is_name_free)
    t('live overlay keeps pick records valid and accepts typ:tags without season/week/picks', test_overlay_and_existing_picks_still_validate)
    t('the previously published required-picks schema still accepts a pick record', test_old_schema_still_accepts_picks)
    print(f'{pass_n} passed, {fail_n} failed')
    sys.exit(1 if fail_n else 0)
