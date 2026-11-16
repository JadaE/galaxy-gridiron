#!/usr/bin/env python3
"""Mock-data tests for C1 (JC-34 round 2): `leaderboard.py rotate` and `lb-admin`. No network, no keys, mock password and
ids only. Run: python3 tools/test_rotate.py"""
import io, json, os, stat, sys, tempfile, contextlib
T = tempfile.mkdtemp(prefix='ggrot-')
os.environ['GG_LEADERBOARD_PASSWORD'] = 'mock-family-pass-123'
os.environ['GG_LB_NAMES'] = os.path.join(T, 'keys', 'leaderboard-names.json')
os.environ['GG_LB_ROTATE_DIR'] = os.path.join(T, 'private', 'jc34')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import leaderboard as L

ok = 0
def check(name, cond):
    global ok
    if not cond: sys.exit('FAIL: ' + name)
    ok += 1; print('  ✓', name)
def run(f):
    """-> (exit message or '', captured stdout)"""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        try: f(); e = ''
        except SystemExit as x: e = str(x)
    return e, buf.getvalue()
mode = lambda p: stat.S_IMODE(os.stat(p).st_mode)

OLD = L.family()
pub = os.path.join(T, 'site'); os.makedirs(os.path.join(pub, '.herenow'))
L.CFG.update({'siteSlug': 'mock-site-0000', 'picksCollection': 'ggoldpicks0000', 'publishSiteDir': pub})
base = {'fields': {'uid': {'type': 'string'}, 'picks': {'type': 'object'}}, 'access': {'read': 'public', 'insert': 'public', 'update': 'owner', 'delete': 'owner'}, 'rateLimit': {'perMinute': 5}}
MAN = {'collections': {'ggoldpicks0000': dict(base, access={'read': 'owner', 'insert': 'none', 'update': 'owner', 'delete': 'owner'}), OLD['live']: base,
                       OLD['archive']: dict(base, fields=dict(base['fields'], oc={'type': 'number', 'minimum': 0}, src={'type': 'string', 'maxLength': 40}))}, 'feedback': {'x': 1}}
mp = os.path.join(pub, '.herenow', 'data.json'); json.dump(MAN, open(mp, 'w'), indent=2)
ORIG_MAN = open(mp).read()

# fake owner API: collections exist only when declared (published) in the manifest
DB = {OLD['live']: [{'id': 'rec_l1', 'createdAt': '2026-10-21T14:00:00.000Z', 'data': {'uid': '1001', 'un': 'mocka', 'season': 2026, 'week': 7, 'picks': {'4010001': 'KC'}, 'bf': {}, 'ts': 1, 'app': 'gg'}}],
      OLD['archive']: [{'id': 'rec_a1', 'createdAt': '2026-11-11T09:00:00.000Z', 'data': {'uid': '1002', 'un': 'mockb', 'season': 2026, 'week': 9, 'picks': {'4010009': 'BUF'}, 'bf': {}, 'ts': 1, 'app': 'gg', 'oc': 1762000000000, 'src': 'fix-rec_x'}}]}
posts, fail = [], {'status': None}
def published(): return json.load(open(mp))['collections']
def fake_owner(m, path, body=None, key=None):
    coll = path.split('?')[0]
    if fail['status']: return fail['status'], {}
    if coll not in published(): return 404, {}
    if m == 'GET': return 200, {'records': DB.get(coll, [])}
    if m == 'POST':
        posts.append((coll, body, key)); DB.setdefault(coll, []).append({'id': 'n%d' % len(posts), 'createdAt': '2026-11-16T18:00:00.000Z', 'data': body}); return 201, {'id': 'n%d' % len(posts)}
    return 405, {}
L.owner = fake_owner

def secrets_in(out, n):
    return [v for v in ((n or {}).get('live', ''), (n or {}).get('archive', ''), OLD['live'], OLD['archive'], OLD['hash'], os.environ['GG_LEADERBOARD_PASSWORD']) if v and v in out]

print('C1 rotate: random names')
e, out = run(lambda: L.cmd_rotate(['rotate', 'new']))
n = L.load_names()
check('`rotate new` writes two random 160-bit names to a 600 file and prints neither', e == '' and mode(L.NAMES_FILE) == 0o600 and not secrets_in(out, n))
check('names are random hex, independent, and not password-derived', all(len(n[k]) == 42 and n[k].startswith('gg') for k in ('live', 'archive'))
      and n['live'] != n['archive'] and n['archive'] != n['live'] + '_a' and not {n['live'], n['archive']} & {OLD['live'], OLD['archive']})
check('two runs of new_names never repeat', L.new_names()['live'] != L.new_names()['live'])
check('`rotate new` refuses to overwrite an existing names file', 'refusing to overwrite' in run(lambda: L.cmd_rotate(['rotate', 'new']))[0] and L.load_names() == n)
check('the names file is under keys/ (gitignored) by default', L.NAMES_FILE.endswith(os.path.join('keys', 'leaderboard-names.json')) and 'keys/' in open(os.path.join(L.ROOT, '.gitignore')).read().split())
os.chmod(L.NAMES_FILE, 0o644); check('a names file readable by others is refused', 'private' in run(L.load_names)[0]); os.chmod(L.NAMES_FILE, 0o600)
check('`rotate secret` refuses to print a name to a terminal', 'refusing' in run(lambda: L.cmd_rotate_secret(['rotate', 'secret', 'live'], io.StringIO(), True))[0])
pipe = io.StringIO(); L.cmd_rotate_secret(['rotate', 'secret', 'archive'], pipe, False)
check('`rotate secret archive` writes exactly that one name into a pipe (for wrangler secret put)', pipe.getvalue() == n['archive'])
check('`manifest --owner-only` on derived names is refused (C1)', 'C1' in run(lambda: L.cmd_manifest(False, True))[0])

print('C1 rotate: declare / copy / close (dry run by default)')
e, out = run(lambda: L.cmd_rotate(['rotate', 'declare']))
check('declare is a dry run by default (manifest unchanged)', e == '' and 'DRY RUN' in out and open(mp).read() == ORIG_MAN)
e, out = run(lambda: L.cmd_rotate(['rotate', 'declare', '--apply']))
c = published()
check('declare --apply adds the new live + archive as OWNER-only read/insert, keeps the old ones', e == '' and c[n['live']]['access']['read'] == 'owner' and c[n['live']]['access']['insert'] == 'owner'
      and c[n['archive']]['access'] == {'read': 'owner', 'insert': 'owner', 'update': 'owner', 'delete': 'owner'} and OLD['live'] in c and 'mv' in c[n['archive']]['fields'])
bk = os.path.join(L.ROTATE_DIR, 'manifest-before-rotate.json')
check('declare saved the previous manifest for rollback (folder 700, file 600, outside the repo)', open(bk).read() == ORIG_MAN and mode(bk) == 0o600 and mode(L.ROTATE_DIR) == 0o700 and not bk.startswith(L.ROOT))
check('declare printed no names', not secrets_in(out, n))
check('close refuses before every old record is copied', 'not copied yet' in run(lambda: L.cmd_rotate(['rotate', 'close', '--apply']))[0] and OLD['live'] in published())
e, out = run(lambda: L.cmd_rotate(['rotate', 'copy']))
check('copy is a dry run by default (no writes, no backup files)', e == '' and 'to copy 2' in out and not posts and not [f for f in os.listdir(L.ROTATE_DIR) if f.startswith('picks-')])
bdir = os.path.join(T, 'bk'); os.makedirs(bdir); os.chmod(bdir, 0o755)
fail['status'] = 500
e, out = run(lambda: L.cmd_rotate(['rotate', 'copy', '--apply', '--backup-dir', bdir]))
check('copy --apply fails CLOSED on an HTTP error: no backup files, nothing copied', 'HTTP 500' in e and os.listdir(bdir) == [] and not posts)
fail['status'] = None
saved = DB.pop(OLD['archive']); man = json.load(open(mp)); arch_def = man['collections'].pop(OLD['archive']); json.dump(man, open(mp, 'w'))
e, out = run(lambda: L.cmd_rotate(['rotate', 'copy', '--apply', '--backup-dir', bdir]))
check('copy --apply fails CLOSED on a 404: no backup files, nothing copied', '404' in e and os.listdir(bdir) == [] and not posts)
DB[OLD['archive']] = saved; man['collections'][OLD['archive']] = arch_def; json.dump(man, open(mp, 'w'))
check('copy refuses a backup folder inside the repo', 'outside the repo' in run(lambda: L.cmd_rotate(['rotate', 'copy', '--apply', '--backup-dir', os.path.join(L.ROOT, 'backups')]))[0] and not posts)
e, out = run(lambda: L.cmd_rotate(['rotate', 'copy', '--apply', '--backup-dir', bdir]))
files = os.listdir(bdir)
check('copy --apply backs up first: 3 files (old live, old archive, new archive), folder forced to 700, files 600', e == '' and len(files) == 3 and mode(bdir) == 0o700 and all(mode(os.path.join(bdir, f)) == 0o600 for f in files))
check('every record goes to the NEW archive only, keeping its original server time in oc', [p[0] for p in posts] == [n['archive']] * 2
      and posts[0][1]['oc'] == L.ms('2026-10-21T14:00:00.000Z') and posts[1][1]['oc'] == 1762000000000 and posts[1][1]['src'] == 'fix-rec_x'
      and {p[1]['mv'] for p in posts} == {'l-rec_l1', 'a-rec_a1'})
check('copy printed no names', not secrets_in(out, n))
e, out = run(lambda: L.cmd_rotate(['rotate', 'copy', '--apply', '--backup-dir', bdir]))
check('copy is idempotent (second run copies 0)', e == '' and 'copied 0' in out and len(posts) == 2)
DB[OLD['live']].append({'id': 'rec_l2', 'createdAt': '2026-11-16T12:00:00.000Z', 'data': {'uid': '1003', 'un': 'mockc', 'season': 2026, 'week': 11, 'picks': {}, 'bf': {}, 'ts': 1, 'app': 'gg'}})
check('close refuses while an old app has sent a record that is not copied yet', 'not copied yet' in run(lambda: L.cmd_rotate(['rotate', 'close', '--apply']))[0])
run(lambda: L.cmd_rotate(['rotate', 'copy', '--apply', '--backup-dir', bdir]))
check('re-running copy catches up the new record', len(posts) == 3 and posts[2][1]['mv'] == 'l-rec_l2')
check('until close, the other tools still use the old names', L.current()['live'] == OLD['live'])
e, out = run(lambda: L.cmd_rotate(['rotate', 'close']))
check('close is a dry run by default', e == '' and 'DRY RUN' in out and OLD['live'] in published())
e, out = run(lambda: L.cmd_rotate(['rotate', 'close', '--apply']))
c = published()
check('close --apply removes BOTH password-derived names from the manifest (they then 404 like any name)', e == '' and OLD['live'] not in c and OLD['archive'] not in c and n['live'] in c and 'ggoldpicks0000' in c and json.load(open(mp))['feedback'] == {'x': 1})
check('after close, the other tools use the random names', L.current() == {'live': n['live'], 'archive': n['archive']})
check('after close, the fake server 404s the old names exactly like a never-used name', fake_owner('GET', OLD['live']) == fake_owner('GET', 'gg' + '0' * 40) == (404, {}))
check('close printed no names', not secrets_in(out, n))
check('legacy migrate/manifest refuse once the rotation started', 'rotate' in run(lambda: L.cmd_migrate(True))[0] and 'rotate' in run(lambda: L.cmd_manifest(True))[0])

print('C1 rotate: verify (read-only probe) and rollback')
check('same_404: identical 404s pass', L.same_404([(404, 'not found'), (404, 'not found'), (404, 'not found')]))
check('same_404: 403 vs 404 (the oracle) fails', not L.same_404([(403, 'forbidden'), (404, 'not found'), (404, 'not found')]))
check('same_404: different bodies fail', not L.same_404([(404, 'no collection <name>'), (404, 'not found'), (404, 'not found')]))
seen = []
e, out = run(lambda: L.cmd_rotate_verify(lambda slug, name: (seen.append(name), (404, 'nf'))[1]))
check('verify probes old live, old archive and a fresh random name, prints only statuses', e == '' and seen[:2] == [OLD['live'], OLD['archive']] and seen[2] not in (n['live'], n['archive']) and 'SAME' in out and not secrets_in(out, n))
e, out = run(lambda: L.cmd_rotate_verify(lambda slug, name: (403, 'x') if name == OLD['live'] else (404, 'nf')))
check('verify exits non-zero on any difference', 'MISMATCH' in e)
# real order after a cut-over: the Worker has written picks to the NEW live; nothing is re-declared by hand here
DB[n['live']] = [{'id': 'rec_n1', 'createdAt': '2026-11-17T15:00:00.000Z', 'data': {'uid': '1001', 'un': 'mocka', 'season': 2026, 'week': 11, 'picks': {'4010011': 'KC'}, 'bf': {}, 'ts': 1, 'app': 'gg'}}]
check('copy-back refuses before rollback phase 1 (it needs both sets declared)', 'phase 1' in run(lambda: L.cmd_rotate(['rotate', 'copy-back', '--apply']))[0])
man_closed = open(mp).read()
e, out = run(lambda: L.cmd_rotate(['rotate', 'rollback']))
check('rollback is a dry run by default', e == '' and 'DRY RUN' in out and open(mp).read() == man_closed)
e, out = run(lambda: L.cmd_rotate(['rotate', 'rollback', '--apply']))
c = published()
check('rollback phase 1 re-declares the old names and KEEPS the new ones declared', e == '' and OLD['live'] in c and OLD['archive'] in c and n['live'] in c and n['archive'] in c)
check('phase 1 prints the real next steps (publish, secrets back, copy-back, then rollback again)', all(x in out for x in ('publish', 'LB_LIVE', 'copy-back --apply', 'rollback --apply')) and not secrets_in(out, n))
check('during the rollback, the tools use the old names', L.current()['live'] == OLD['live'])
e, out = run(lambda: L.cmd_rotate(['rotate', 'rollback', '--apply']))
check('rollback phase 2 REFUSES while new-live picks are not copied back (new collections stay declared)', 'not copied back' in e and n['live'] in published())
before = len(posts)
e, out = run(lambda: L.cmd_rotate(['rotate', 'copy-back']))
check('copy-back is a dry run by default', e == '' and 'to copy 1' in out and len(posts) == before)
bdir2 = os.path.join(T, 'bk2')
e, out = run(lambda: L.cmd_rotate(['rotate', 'copy-back', '--apply', '--backup-dir', bdir2]))
check('copy-back --apply (new collections still declared) backs up, then puts the new-live picks into the OLD archive with their server time',
      e == '' and len(os.listdir(bdir2)) == 2 and posts[-1][0] == OLD['archive'] and posts[-1][1]['oc'] == L.ms('2026-11-17T15:00:00.000Z') and posts[-1][1]['mv'] == 'r-rec_n1')
DB[n['live']].append({'id': 'rec_n2', 'createdAt': '2026-11-17T16:00:00.000Z', 'data': {'uid': '1002', 'un': 'mockb', 'season': 2026, 'week': 11, 'picks': {}, 'bf': {}, 'ts': 1, 'app': 'gg'}})
check('a pick that lands after copy-back blocks phase 2 again', 'not copied back' in run(lambda: L.cmd_rotate(['rotate', 'rollback', '--apply']))[0])
run(lambda: L.cmd_rotate(['rotate', 'copy-back', '--apply', '--backup-dir', bdir2]))
e, out = run(lambda: L.cmd_rotate(['rotate', 'rollback']))
check('phase 2 is a dry run by default', e == '' and 'DRY RUN' in out and n['live'] in published())
e, out = run(lambda: L.cmd_rotate(['rotate', 'rollback', '--apply']))
check('rollback phase 2 restores the saved manifest byte for byte, only after every pick is copied back', e == '' and open(mp).read() == ORIG_MAN)
old_arch_ids = {r['data'].get('mv') for r in DB[OLD['archive']]}
check('no cut-over write is stranded: every new-live record is in the old archive', {'r-rec_n1', 'r-rec_n2'} <= old_arch_ids)
check('after rollback, the tools use the old names again', L.current()['live'] == OLD['live'])

print('lb-admin (Worker D1: owner reset / revoke / alerts)')
e, out = run(lambda: L.cmd_lb_admin(['lb-admin', 'revoke-uid', '1001']))
check('revoke-uid is a dry run by default and targets that uid only', e == '' and 'DRY RUN' in out and "WHERE uid = '1001'" in out)
check('revoke-uid refuses a non-numeric uid (no SQL injection)', 'usage' in run(lambda: L.lb_admin_sql(['lb-admin', 'revoke-uid', "1' OR 1=1 --"]))[0])
ran = []
L.cmd_lb_admin(['lb-admin', 'revoke-all', '--apply'], run=lambda cmd, **k: ran.append(cmd))
check('revoke-all --apply runs one wrangler d1 execute on gg-caps', ran and ran[0][:6] == ['npx', 'wrangler', 'd1', 'execute', 'gg-caps', '--remote'] and 'DELETE FROM lbtokens' in ran[0][-1])

import shutil; shutil.rmtree(T)
print(f'{ok} passed, 0 failed')
