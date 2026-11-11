#!/usr/bin/env python3
"""Mock-data tests for `leaderboard.py fix-late-week` (plan_fix). No network, no keys. Run: python3 tools/test_fix_late_week.py"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import leaderboard as L

U, V = '1000000000000000201', '1000000000000000202'
T0 = 1_800_000_000_000; H = 3_600_000
kick = {'9001': T0, '9002': T0 + 70 * H, '9003': T0 + 73 * H, '9004': T0 + 96 * H}  # Thu, Sun, Sun, Mon
iso = lambda ms: L.datetime.fromtimestamp(ms / 1000, L.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
rec = lambda i, uid, week, picks, at, **k: {'id': i, 'createdAt': iso(at), 'data': {'uid': uid, 'un': 'mock', 'season': 2026, 'week': week, 'picks': picks, 'bf': {}, 'ts': 1, 'app': 'gg', **k}}
late = rec('rec_late', U, 9, {'9001': 'AAA', '9002': 'BBB', '9003': 'CCC', '9004': 'DDD'}, T0 + 130 * H)
live = [late, rec('rec_other', V, 9, {'9002': 'BBB'}, T0), rec('rec_w10', U, 10, {'9101': 'EEE'}, T0 + 131 * H)]
ok = 0
def check(name, cond):
    global ok
    if not cond: sys.exit('FAIL: ' + name)
    ok += 1; print('  ✓', name)

p = L.plan_fix(live, [], kick, U, 2026, 9, ['9001'])
check('only the late-ruled game is left out of the fix record', sorted(p['record']['picks']) == ['9002', '9003', '9004'] and p['late'] == ['9001'])
check('oc is 1 minute before the earliest corrected kickoff and after the late game', p['record']['oc'] == kick['9002'] - 60_000 > kick['9001'])
check('scoped to one user + one week, src ties it to the source record', p['record']['uid'] == U and p['record']['week'] == 9 and p['record']['src'] == 'fix-rec_late')
check('idempotent: a second run is a no-op', L.plan_fix(live, [{'id': 'a1', 'data': p['record']}], kick, U, 2026, 9, ['9001']).get('noop'))
check('refuses when the record has backfill flags', not L.plan_fix([rec('r', U, 9, {'9002': 'BBB'}, T0 + 130 * H, bf={'9002': 1})], [], kick, U, 2026, 9)['ok'])
check('refuses with two live records for the user+week', not L.plan_fix(live + [rec('r2', U, 9, {'9002': 'BBB'}, T0 + 131 * H)], [], kick, U, 2026, 9)['ok'])
check('refuses when the archive already has that user+week', not L.plan_fix(live, [rec('a2', U, 9, {'9002': 'BBB'}, T0, oc=T0)], kick, U, 2026, 9)['ok'])
pm = L.plan_fix(live, [], kick, U, 2026, 9, ['9004'])
check('a late-ruled later game (Monday) is simply left out and stays late', sorted(pm['record']['picks']) == ['9001', '9002', '9003'] and pm['late'] == ['9004'])
check('no-op for another user with nothing late', L.plan_fix(live, [], kick, V, 2026, 9).get('noop'))
print(f'{ok} passed, 0 failed')
