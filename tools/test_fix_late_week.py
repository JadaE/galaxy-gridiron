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
# rollback: exact tag + season + user + week, exactly one match
fixrec = {'id': 'arec1', 'data': p['record']}
check('rollback finds exactly the fix record', L.plan_rollback([fixrec], U, 2026, 9, 'rec_late') == {'ok': True, 'id': 'arec1', 'tag': 'fix-rec_late'})
check('rollback ignores other fix- tags', not L.plan_rollback([dict(fixrec, data=dict(p['record'], src='fix-rec_other'))], U, 2026, 9, 'rec_late')['ok'])
check('rollback checks the season', not L.plan_rollback([fixrec], U, 2025, 9, 'rec_late')['ok'])
check('rollback refuses two matches', not L.plan_rollback([fixrec, dict(fixrec, id='arec2')], U, 2026, 9, 'rec_late')['ok'])
check('rollback refuses zero matches', not L.plan_rollback([], U, 2026, 9, 'rec_late')['ok'])
# pinning: free targeting is refused, and a non-pinned user id is refused
def exits(f):
    try: f()
    except SystemExit as e: return str(e)
    return ''
for k in ('--uid', '--week', '--season', '--late-games'):
    check(f'refuses {k}', 'not accepted' in exits(lambda: L.cmd_fix_late_week(['fix-late-week', '--source-id', 'rec_x', k, '1'])))
check('refuses a missing --source-id', 'source-id' in exits(lambda: L.cmd_fix_late_week(['fix-late-week'])))
os.environ['GG_JC17_UID'] = U; L.CFG.pop('jc17Uid', None)
check('refuses a user id that is not the pinned JC-17 user', 'not the pinned one' in exits(lambda: L.cmd_fix_late_week(['fix-late-week', '--source-id', 'rec_x'])))
check('pin is season 2026, week 9, Thursday ruled late', (L.JC17_SEASON, L.JC17_WEEK, L.JC17_LATE) == (2026, 9, ('401873037',)))
check('backups refuse a folder inside the repo', 'outside the repo' in exits(lambda: (setattr(L, 'family', lambda: {}), L.cmd_backup(os.path.join(L.ROOT, 'backups')))))
check('default backup folder is outside the repo and outside the app workspace', not L.BACKUP_DIR.startswith(L.ROOT) and '/fantasy-football' not in L.BACKUP_DIR)
# ---- rollback command (mocked server; no network) ----
import tempfile, stat
calls = []
def fake_list(c):
    calls.append(('GET', c)); return [fixrec] if c == 'ARCH' else []
def fake_owner(m, path, body=None, key=None):
    calls.append((m, path)); return fake_owner.st, {}
fake_owner.st = 204
def no_espn(*a): raise AssertionError('ESPN must not be called')
L.family = lambda: {'live': 'LIVE', 'archive': 'ARCH'}; L.list_all = fake_list; L.owner = fake_owner; L.espn_week = no_espn
L.jc17_uid = lambda: U
RB = ['fix-late-week', '--source-id', 'rec_late', '--rollback']
calls.clear(); e = exits(lambda: L.cmd_fix_late_week(RB))
check('rollback is a dry run by default (no DELETE without --apply)', e == '' and not any(c[0] == 'DELETE' for c in calls))
check('rollback never calls ESPN and reads only the archive', [c for c in calls if c[0] == 'GET'] == [('GET', 'ARCH')])
calls.clear(); fake_owner.st = 204; e = exits(lambda: L.cmd_fix_late_week(RB + ['--apply']))
check('rollback --apply deletes exactly the one fix record', e == '' and [c for c in calls if c[0] == 'DELETE'] == [('DELETE', 'ARCH/arec1')])
for st in (403, 404, 500):
    fake_owner.st = st; e = exits(lambda: L.cmd_fix_late_week(RB + ['--apply']))
    check(f'rollback exits non-zero when the delete fails (HTTP {st})', e.startswith('delete failed'))
calls.clear(); e = exits(lambda: L.cmd_fix_late_week(['fix-late-week', '--source-id', 'rec_other', '--rollback', '--apply']))
check('rollback with a different source id matches nothing and deletes nothing', e.startswith('STOP') and not any(c[0] == 'DELETE' for c in calls))
L.list_all = lambda c: [dict(fixrec, data=dict(p['record'], season=2025))] if c == 'ARCH' else []
calls.clear(); e = exits(lambda: L.cmd_fix_late_week(RB + ['--apply']))
check('rollback refuses a fix record from another season', e.startswith('STOP') and not any(c[0] == 'DELETE' for c in calls))
L.list_all = lambda c: [dict(fixrec, data=dict(p['record'], src='fix-rec_late2'))] if c == 'ARCH' else []
check('rollback refuses a prefix-similar fix- tag', exits(lambda: L.cmd_fix_late_week(RB)).startswith('STOP'))
# ---- backup: folder forced to 700, never an empty/partial backup ----
L.CFG['picksCollection'] = 'OLD'
with tempfile.TemporaryDirectory() as t:
    d = os.path.join(t, 'bk'); os.makedirs(d); os.chmod(d, 0o755)
    L.list_all = lambda c: [{'id': 'r_' + c}]
    check('backup succeeds with mock data', exits(lambda: L.cmd_backup(d)) == '' and len(os.listdir(d)) == 3)
    check('backup tightens an existing 755 folder to 700', stat.S_IMODE(os.stat(d).st_mode) == 0o700)
    check('backup files are 600', all(stat.S_IMODE(os.stat(os.path.join(d, x)).st_mode) == 0o600 for x in os.listdir(d)))
    d2 = os.path.join(t, 'bk2')
    L.list_all = lambda c: None if c == 'LIVE' else [{'id': 'r'}]
    e = exits(lambda: L.cmd_backup(d2))
    check('backup FAILS on a 404 and writes nothing', 'FAILED' in e and not (os.path.exists(d2) and os.listdir(d2)))
    def boom(c):
        if c == 'ARCH': sys.exit('list failed: HTTP 500 ')
        return [{'id': 'r'}]
    L.list_all = boom
    e = exits(lambda: L.cmd_backup(d2))
    check('backup FAILS on an HTTP error and writes nothing', 'HTTP 500' in e and not (os.path.exists(d2) and os.listdir(d2)))
print(f'{ok} passed, 0 failed')
