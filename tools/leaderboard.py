#!/usr/bin/env python3
"""Family leaderboard tooling (box only, owner API). Never prints the password or the derived collection names.

The two here.now Site Data collections are named from the shared password (same derivation since v0.0.12):
  live    = "gg" + sha256(SALT + "\\n" + password)[:40]   (one insert-only snapshot per person per week)
  archive = live + "_a"                                   (OWNER insert: picks copied from the old collection,
                                                           each with its original server time in `oc`)
Since v0.0.15 (JC-34) the APP no longer derives these names or talks to Site Data for picks: it unlocks through the AI
Worker (/lb/unlock checks the password server-side with a rate limit + lockout and returns an lb_ token bound to one
Sleeper uid), and the Worker reads/writes both collections with the owner key (LB_LIVE / LB_ARCHIVE in its config).
The password comes ONLY from $GG_LEADERBOARD_PASSWORD.

C1 (JC-34 round 2, Security Lead): password-derived names are an offline password oracle (anyone can derive the name for a
guess and probe here.now, bypassing the Worker's limits). So the cut-over moves every record to NEW RANDOM collection names
(>= 128 bits, not derived from anything) that exist only in the private names file and as the Worker secrets LB_LIVE /
LB_ARCHIVE, then removes the old derived names from the manifest so they answer like any name that never existed.
`manifest --owner-only` on the derived names is refused (it would keep the oracle). Derived names are used only by the
legacy commands until `rotate close`, and by the one-time copy. Every rotate step is a DRY RUN unless given --apply.

  python3 tools/leaderboard.py rotate new           # make the random names -> keys/leaderboard-names.json (600, gitignored).
                                                    # Never printed. Refuses to overwrite an existing names file.
  python3 tools/leaderboard.py rotate secret live|archive | npx wrangler secret put LB_LIVE|LB_ARCHIVE
                                                    # pipes ONE name into wrangler; refuses to write it to a terminal
  python3 tools/leaderboard.py rotate declare [--apply]
                                                    # manifest: add the new live + archive, OWNER read/insert only; saves the
                                                    # current manifest to the backup folder first (for rollback)
  python3 tools/leaderboard.py rotate copy [--apply] [--backup-dir DIR]
                                                    # backup (fails closed) of the old live + archive, then copy every record
                                                    # into the NEW archive with its original server time in `oc` (`mv` marks
                                                    # the source). Idempotent: re-run to catch up picks old apps still send.
  python3 tools/leaderboard.py rotate close [--apply]
                                                    # manifest: remove the old derived names (they then 404 like any unknown
                                                    # name). Refuses unless every old record is already copied.
  python3 tools/leaderboard.py rotate verify        # read-only public probe: old live, old archive and a never-used random
                                                    # name must give the SAME status and body. Prints statuses only.
  python3 tools/leaderboard.py rotate rollback [--apply]
                                                    # put back the manifest saved by `declare` (old names live again)
  python3 tools/leaderboard.py rotate copy-back [--apply] [--backup-dir DIR]
                                                    # after a rollback: backup, then copy picks the Worker wrote to the NEW
                                                    # live into the OLD archive (with `oc`), so nothing is lost
  python3 tools/leaderboard.py lb-admin alerts|revoke-uid UID|revoke-all [--apply]
                                                    # Worker D1 (P2-1/P2-2/P2-3): prints the `wrangler d1 execute` command;
                                                    # --apply runs it (needs the owner's Cloudflare login)

  python3 tools/leaderboard.py keys                # write keys/family-collections.json (chmod 600) so the secret checks know the names
  python3 tools/leaderboard.py manifest [--dry-run] # declare live + archive in <publishSiteDir>/.herenow/data.json and close the
                                                    # OLD picks collection (read owner, insert none). The feedback block is untouched.
  python3 tools/leaderboard.py manifest --owner-only   # REFUSED since JC-34 round 2 (C1): use `rotate` (below)
  python3 tools/leaderboard.py migrate [--dry-run]  # copy every OLD picks record into the archive with the owner API
                                                    # (idempotent: skips records already copied). Needs the new manifest LIVE.
  python3 tools/leaderboard.py status               # record counts: old / archive / live (owner API)
  python3 tools/leaderboard.py backup [DIR]         # owner read of old / archive / live into DIR (default /workspace/gg-private-backups/jc17,
                                                    # outside the repo; folder forced to 700 even if it exists, files 600). Read-only on
                                                    # the server. Fails (writes nothing) if any collection is 404 or errors.
                                                    # CLEANUP: delete the JC-17 backups once JC-17 is closed (they hold everyone's picks).
  python3 tools/leaderboard.py fix-late-week --source-id REC_ID [--from-backup DIR] [--games FILE] [--out FILE]
                                                    [--apply] | [--rollback [--apply]]
      JC-17 ONLY: one-time, OWNER-APPROVED correction. PINNED to season 2026, week 9 and one user whose id is read from
      $GG_JC17_UID or app/config.local.json "jc17Uid" (gitignored) and must match the hash below; any other value is refused.
      --source-id must equal the one live record found for that user+week (the owner confirms it from the dry run).
      Dry run by default (prints the record id, every pick, kickoffs and oc). --apply inserts ONE owner-only archive record
      (src "fix-<source id>") with that week's picks, `oc` = 1 minute before the earliest corrected kickoff. Idempotent.
      --rollback plans the removal of exactly that record (exact src + season + user + week, exactly one match);
      --rollback --apply deletes it (non-zero exit if the delete fails). Rollback reads only the archive (no ESPN call).
      The late live record is never changed; no app rule trusts phone clocks.
Needs: app/config.local.json (siteSlug, picksCollection, publishSiteDir) and $HERENOW_API_KEY for migrate/status/backup/fix-late-week\n(fix-late-week dry run with --from-backup and --games needs no key).
"""
import hashlib, json, os, sys, time, glob, shutil, urllib.request, urllib.error
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CP = os.path.join(ROOT, 'app', 'config.local.json')
CFG = json.load(open(_CP)) if os.path.exists(_CP) else {}
SALT = 'galaxy-gridiron/leaderboard/v1'
API = 'https://here.now/api/v1/publishes'


def family():
    pw = os.environ.get('GG_LEADERBOARD_PASSWORD', '')
    if not pw.strip():
        sys.exit('GG_LEADERBOARD_PASSWORD is not set')
    h = hashlib.sha256((SALT + '\n' + pw.strip()).encode()).hexdigest()
    live = 'gg' + h[:40]
    return {'live': live, 'archive': live + '_a', 'hash': h}


NAMES_FILE = os.environ.get('GG_LB_NAMES') or os.path.join(ROOT, 'keys', 'leaderboard-names.json')
ROTATE_DIR = os.environ.get('GG_LB_ROTATE_DIR') or '/workspace/gg-private-backups/jc34'
NAME_BYTES = 20  # 160 bits; 'gg' + 40 hex chars, the same shape here.now already accepts


def load_names():
    if not os.path.exists(NAMES_FILE): return None
    if os.stat(NAMES_FILE).st_mode & 0o077: sys.exit('STOP: the names file must be private (chmod 600)')
    n = json.load(open(NAMES_FILE))
    if not (isinstance(n.get('live'), str) and isinstance(n.get('archive'), str)): sys.exit('STOP: names file is malformed')
    return n


def current():
    """Collections the tools should read/write now: the random names once `rotate close` has run, else the legacy ones."""
    n = load_names()
    if n and n.get('step', 0) == 3: return {'live': n['live'], 'archive': n['archive']}  # 3 = closed (4 = rolled back)
    return family()


def owner(method, path, body=None, key=None):
    req = urllib.request.Request(f"{API}/{CFG['siteSlug']}/data/{path}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer ' + os.environ['HERENOW_API_KEY'], 'X-HereNow-Client': 'cursor/direct-api',
                                          'content-type': 'application/json', **({'Idempotency-Key': key} if key else {})})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try: return e.code, json.load(e)
        except Exception: return e.code, {}


def list_all(coll):
    out, cur = [], None
    while True:
        st, j = owner('GET', f"{coll}?limit=100" + (f"&cursor={urllib.request.quote(cur)}" if cur else ''))
        if st == 404: return None
        if st != 200: sys.exit(f'list failed: HTTP {st} {j.get("code", "")}')
        out += j.get('records', []); cur = j.get('nextCursor')
        if not cur: return out


def manifest_path():
    pub = CFG.get('publishSiteDir') or os.path.join(ROOT, 'publish-site')
    return os.path.join(pub, '.herenow', 'data.json')


def cmd_manifest(dry, owner_only=False):
    if owner_only:
        sys.exit('STOP (C1): owner-only access on password-derived names is still a password oracle. Use `rotate` '
                 '(new random names held only as Worker secrets) instead.')
    if (load_names() or {}).get('step', 0) >= 1: sys.exit('STOP: the random-name rotation has started; use `rotate`')
    f, p = family(), manifest_path()
    m = json.load(open(p)); cols = m['collections']; old = CFG['picksCollection']
    if old not in cols: sys.exit('old picks collection is not in the manifest')
    base = json.loads(json.dumps(cols[old]))
    live = dict(base, access={'read': 'owner' if owner_only else 'public', 'insert': 'owner' if owner_only else 'public', 'update': 'owner', 'delete': 'owner'})
    arch = json.loads(json.dumps(base)); arch['fields']['oc'] = {'type': 'number', 'minimum': 0}; arch['fields']['src'] = {'type': 'string', 'maxLength': 40}
    arch['access'] = {'read': 'owner' if owner_only else 'public', 'insert': 'owner', 'update': 'owner', 'delete': 'owner'}; arch.pop('rateLimit', None)
    cols[f['live']] = live; cols[f['archive']] = arch
    cols[old]['access'] = {'read': 'owner', 'insert': 'none', 'update': 'owner', 'delete': 'owner'}
    if len(cols) > 10: sys.exit('too many collections')
    out = json.dumps(m, indent=2) + '\n'
    if len(out) > 64000: sys.exit('manifest too large')
    mode = 'live + archive owner-only (Worker is the only reader/writer)' if owner_only else 'live public read+insert'
    if dry: print(f'manifest OK (dry run): {len(cols)} collections; {mode}; old picks -> read owner / insert none; feedback untouched'); return
    open(p, 'w').write(out)
    print(f'manifest written: {len(cols)} collections (old picks closed to new writes and public reads; feedback block unchanged)')


def cmd_keys():
    f = current(); p = os.path.join(ROOT, 'keys', 'family-collections.json')
    with open(os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as fh: json.dump({'live': f['live'], 'archive': f['archive']}, fh)
    os.chmod(p, 0o600); print('wrote keys/family-collections.json (600)')


def cmd_status():
    f = current()
    for label, c in (('old', CFG['picksCollection']), ('archive', f['archive']), ('live', f['live'])):
        r = list_all(c); print(f'{label}: ' + ('not active (manifest not published yet)' if r is None else f'{len(r)} records'))


def cmd_migrate(dry):
    if (load_names() or {}).get('step', 0) >= 1: sys.exit('STOP: the random-name rotation has started; use `rotate copy`')
    f = family(); old = list_all(CFG['picksCollection'])
    if old is None: sys.exit('old collection not readable')
    arch = list_all(f['archive'])
    if arch is None:
        print(f'old: {len(old)} records; archive: not active yet (publish the v0.0.12 manifest first). Nothing copied.'); return
    done = {r['data'].get('src') for r in arch}
    todo = [r for r in old if r['id'] not in done]
    print(f'old: {len(old)} records; archive: {len(arch)} already copied; to copy: {len(todo)}' + (' (dry run)' if dry else ''))
    if dry: return
    ok = 0
    for r in todo:
        d = {k: v for k, v in r['data'].items() if k in ('uid', 'un', 'av', 'season', 'week', 'picks', 'bf', 'ts', 'app')}
        d['oc'] = int(datetime.fromisoformat(r['createdAt'].replace('Z', '+00:00')).timestamp() * 1000); d['src'] = r['id']
        st, j = owner('POST', f['archive'], d, key='mig-' + r['id'])
        if st in (200, 201): ok += 1
        else: sys.exit(f'copy stopped after {ok}: HTTP {st} {j.get("code", "")}')
    after = list_all(f['archive'])
    print(f'copied {ok}; archive now {len(after)} records (old: {len(old)})')


def ms(iso):
    return int(datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp() * 1000)


BACKUP_DIR = '/workspace/gg-private-backups/jc17'


def private_dir(d):
    """A folder OUTSIDE the repo, forced to 700 (also tightens an existing, looser folder)."""
    d = os.path.abspath(d)
    if d == ROOT or d.startswith(ROOT + os.sep): sys.exit('backups must go outside the repo')
    os.makedirs(d, mode=0o700, exist_ok=True); os.chmod(d, 0o700)
    if os.stat(d).st_mode & 0o077: sys.exit('backup FAILED: could not make the backup folder 700')
    return d


def write_private(p, obj):
    with open(os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as fh: json.dump(obj, fh)
    os.chmod(p, 0o600)


def backup_collections(d, pairs, note):
    """Read EVERY collection first: a 404 (collection not active) or any HTTP error stops the backup before a single file
    is written, so a backup is never silently empty or partial (list_all exits non-zero on any non-200/404 status)."""
    if os.path.abspath(d) == ROOT or os.path.abspath(d).startswith(ROOT + os.sep): sys.exit('backups must go outside the repo')
    got = []
    for label, c in pairs:
        r = list_all(c)
        if r is None: sys.exit(f'backup FAILED: {label} collection returned 404 (not active); nothing written')
        got.append((label, r))
    d = private_dir(d)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    for label, r in got:
        write_private(os.path.join(d, f'picks-{label}-{stamp}.json'), r)
        print(f'{label}: {len(r)} records -> picks-{label}-{stamp}.json (600)')
    print(note)
    return dict(got)


def cmd_backup(d):
    d = os.path.abspath(d or BACKUP_DIR)
    if d == ROOT or d.startswith(ROOT + os.sep): sys.exit('backups must go outside the repo')
    f = current()
    backup_collections(d or BACKUP_DIR, (('old', CFG['picksCollection']), ('archive', f['archive']), ('live', f['live'])),
                       'cleanup: delete this folder once JC-17 is closed')


def espn_week(season, week):
    """{gameId: {'k': kickoff ms, 'away': abbr, 'home': abbr}} from ESPN's public scoreboard."""
    u = f'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week={int(week)}&seasontype=2&dates={int(season)}'
    with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'gg-tools'})) as r: j = json.load(r)
    out = {}
    for e in j.get('events', []):
        t = {c['homeAway']: c['team']['abbreviation'] for c in e['competitions'][0]['competitors']}
        out[str(e['id'])] = {'k': ms(e['date']), 'away': t.get('away', '?'), 'home': t.get('home', '?')}
    return out


# ---- JC-17 pin: season 2026, week 9, one user (id kept out of the public repo; only a salted hash is here) ----
JC17_SEASON, JC17_WEEK, JC17_LATE = 2026, 9, ('401873037',)  # 401873037 = the Thursday game (ruled late; not picked)
JC17_UID_SHA = 'fa9bd8f6591e2b69a9c1e0e8cf7525427bc0b257ab7be6f27d7c39983a085cdf'
jc17_hash = lambda uid: hashlib.sha256(('gg-jc17\n' + str(uid)).encode()).hexdigest()


def jc17_uid():
    uid = os.environ.get('GG_JC17_UID') or CFG.get('jc17Uid') or ''
    if not uid or jc17_hash(uid) != JC17_UID_SHA: sys.exit('STOP: the JC-17 user id ($GG_JC17_UID or config "jc17Uid") is missing or not the pinned one')
    return uid


def plan_fix(live, arch, kick, uid, season, week, late_games=()):
    """Pure: decide the one archive record to insert (or why not). live/arch = owner record lists; kick = {gameId: kickoff ms}."""
    mine = lambda r: r.get('data', {}).get('uid') == uid and r['data'].get('season') == season and r['data'].get('week') == week and r['data'].get('app') == 'gg'
    src_live = [r for r in live if mine(r)]
    if len(src_live) != 1: return {'ok': False, 'why': f'expected exactly 1 live record for this user+week, found {len(src_live)}'}
    r = src_live[0]; d = r['data']; tag = 'fix-' + r['id']
    if len(tag) > 40: return {'ok': False, 'why': 'record id too long for src'}
    done = [a for a in arch if a.get('data', {}).get('src') == tag]
    if done: return {'ok': True, 'noop': True, 'why': 'already applied', 'archive_id': done[0]['id'], 'source': r['id']}
    other = [a for a in arch if mine(a)]
    if other: return {'ok': False, 'why': f'archive already has {len(other)} record(s) for this user+week; not touching'}
    if d.get('bf'): return {'ok': False, 'why': 'record has backfill flags; those picks were not made live'}
    created = ms(r['createdAt']); late_games = set(map(str, late_games))
    missing = [g for g in d['picks'] if g not in kick]
    if missing: return {'ok': False, 'why': f'{len(missing)} picked game(s) not in this week\'s schedule'}
    already = sorted(g for g in d['picks'] if created < kick[g])
    late = sorted(g for g in d['picks'] if g in late_games)
    fix = sorted(g for g in d['picks'] if g not in late_games and created >= kick[g])
    if not fix: return {'ok': True, 'noop': True, 'why': 'no late picks to correct', 'source': r['id']}
    oc = min(kick[g] for g in fix) - 60_000
    rec = {'uid': d['uid'], 'un': d['un'], **({'av': d['av']} if d.get('av') else {}), 'season': season, 'week': week,
           'picks': {g: d['picks'][g] for g in fix}, 'bf': {}, 'ts': d.get('ts', 0), 'app': 'gg', 'oc': oc, 'src': tag}
    return {'ok': True, 'noop': False, 'source': r['id'], 'source_created': created, 'record': rec,
            'fix': fix, 'late': late, 'already_on_time': already, 'not_picked_late': sorted(g for g in late_games if g not in d['picks'])}


def _arg(a, k, default=None):
    return a[a.index(k) + 1] if k in a and a.index(k) + 1 < len(a) else default


def _latest(d, label):
    fs = sorted(glob.glob(os.path.join(d, f'*{label}-*.json')), key=os.path.getmtime)
    if not fs: sys.exit(f'no {label} backup in that folder')
    return json.load(open(fs[-1]))


def plan_rollback(arch, uid, season, week, source_id):
    tag = 'fix-' + source_id
    m = [x for x in arch if x.get('data', {}).get('src') == tag and x['data'].get('uid') == uid and x['data'].get('season') == season and x['data'].get('week') == week]
    if len(m) != 1: return {'ok': False, 'why': f'expected exactly 1 archive record with src {tag} for this user+season+week, found {len(m)}'}
    return {'ok': True, 'id': m[0]['id'], 'tag': tag}


def cmd_fix_late_week(a):
    for k in ('--uid', '--week', '--season', '--late-games'):
        if k in a: sys.exit(f'STOP: {k} is not accepted; this tool is pinned to JC-17 (season {JC17_SEASON}, week {JC17_WEEK})')
    src_id = _arg(a, '--source-id')
    if not src_id or not src_id.startswith('rec_'): sys.exit('need --source-id rec_... (the live record id shown by the dry run)')
    uid, season, week, late_games = jc17_uid(), JC17_SEASON, JC17_WEEK, list(JC17_LATE)
    apply_, rollback, bdir = '--apply' in a, '--rollback' in a, _arg(a, '--from-backup')
    if (apply_ or rollback) and bdir: sys.exit('--apply/--rollback read the live server, not a backup')
    if rollback:
        # Rollback needs only the archive: no schedule, no ESPN call. Dry run unless --apply; exact src tag + season +
        # user + week, exactly one match; any failed delete exits non-zero.
        f = current(); arch = list_all(f['archive'])
        if arch is None: sys.exit('archive collection not active')
        print(f'read from server (read-only): archive {len(arch)} records')
        r = plan_rollback(arch, uid, season, week, src_id)
        if not r['ok']: sys.exit('STOP: ' + r['why'])
        print(f"rollback plan: delete archive record {r['id']} (src {r['tag']}, season {season}, week {week})")
        if not apply_: print('DRY RUN: nothing deleted. Add --apply to delete exactly that record.'); return
        st, j = owner('DELETE', f"{f['archive']}/{r['id']}")
        if st not in (200, 204): sys.exit(f'delete failed: HTTP {st} {j.get("code", "")}')
        print(f"deleted 1 archive record {r['id']}"); return
    if _arg(a, '--games'):
        g = json.load(open(_arg(a, '--games')))
        sched = {str(k): (v if isinstance(v, dict) else {'k': int(v), 'away': '?', 'home': '?'}) for k, v in g.items()}
    else: sched = espn_week(season, week)
    kick = {k: v['k'] for k, v in sched.items()}
    if bdir: live, arch, where = _latest(bdir, 'live'), _latest(bdir, 'archive'), 'backup'
    else:
        f = current(); live, arch, where = list_all(f['live']), list_all(f['archive']), 'server (read-only)'
        if live is None or arch is None: sys.exit('live/archive collection not active')
    print(f'read from {where}: live {len(live)} records, archive {len(arch)} records')
    p = plan_fix(live, arch, kick, uid, season, week, late_games)
    ct = lambda t: datetime.fromtimestamp(t / 1000).strftime('%a %b %d %I:%M %p CT')
    if not p['ok']: sys.exit('STOP: ' + p['why'])
    if p['source'] != src_id: sys.exit(f"STOP: --source-id does not match the live record for this user+week ({p['source']})")
    if p.get('noop'): print(f"nothing to do: {p['why']} (source {p['source']})"); return
    rec = p['record']
    print(f"season {season} week {week}; source live record: {p['source']} (server time {ct(p['source_created'])}; phone last-edit time {ct(rec['ts'])})")
    print(f"  on time (into archive record): {len(p['fix'])}   kept late: {len(p['late'])} {p['late']}   already on time: {len(p['already_on_time'])}")
    if p['not_picked_late']: print(f"  ruled-late games with no pick (nothing to mark): {p['not_picked_late']}")
    for gid in sorted(rec['picks'], key=lambda x: (kick[x], x)):
        s_ = sched[gid]; print(f"    {gid}  {s_['away']:>3} @ {s_['home']:<3}  picked {rec['picks'][gid]:<3}  kickoff {ct(kick[gid])}")
    print(f"  archive record: src={rec['src']}  oc={ct(rec['oc'])} (1 min before the earliest corrected kickoff {ct(min(kick[g] for g in p['fix']))})")
    if _arg(a, '--out'):
        with open(os.open(_arg(a, '--out'), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as fh: json.dump(rec, fh)
    if not apply_: print('DRY RUN: nothing written. Add --apply to insert the 1 archive record.'); return
    st, j = owner('POST', current()['archive'], rec, key=rec['src'])
    if st not in (200, 201): sys.exit(f'insert failed: HTTP {st} {j.get("code", "")}')
    print(f"inserted 1 archive record {j.get('id', j.get('record', {}).get('id', '?'))}; re-run without --apply to confirm 'already applied'")


# ---------------- C1 (JC-34 round 2): move to random collection names ----------------
import secrets, re, subprocess

STEP = {'new': 0, 'declared': 1, 'copied': 2, 'closed': 3, 'rolled_back': 4}  # stored as numbers (no strings for the secret scan)


def new_names():
    live, arch = 'gg' + secrets.token_hex(NAME_BYTES), 'gg' + secrets.token_hex(NAME_BYTES)
    assert live != arch
    return {'live': live, 'archive': arch, 'step': STEP['new']}


def save_names(n):
    os.makedirs(os.path.dirname(NAMES_FILE), mode=0o700, exist_ok=True)
    write_private(NAMES_FILE, n)


def need_names():
    n = load_names()
    if not n: sys.exit('STOP: no names file yet; run `rotate new` first')
    old = family()
    if {n['live'], n['archive']} & {old['live'], old['archive']}: sys.exit('STOP: a new name equals a password-derived name')
    return n


def cmd_rotate_new():
    if os.path.exists(NAMES_FILE): sys.exit('STOP: a names file already exists; refusing to overwrite it (the Worker may use it)')
    save_names(new_names())
    print('wrote the new random collection names to the private names file (600). They are not printed.')
    print('next: `rotate declare` (dry run), then `rotate declare --apply` and publish the site')


def cmd_rotate_secret(a, out=None, isatty=None):
    out = out or sys.stdout; isatty = isatty if isatty is not None else out.isatty()
    which = a[2] if len(a) > 2 else ''
    if which not in ('live', 'archive'): sys.exit('usage: rotate secret live|archive | npx wrangler secret put LB_LIVE|LB_ARCHIVE')
    if isatty: sys.exit('STOP: refusing to print a collection name to a terminal; pipe it into `npx wrangler secret put`')
    out.write(need_names()[which]); out.flush()


def _manifest():
    p = manifest_path(); return p, json.load(open(p))


def _new_defs(cols, old):
    base_live, base_arch = cols.get(old['live']), cols.get(old['archive'])
    if not base_live or not base_arch: sys.exit('STOP: the current live/archive collections are not in the manifest')
    lock = {'read': 'owner', 'insert': 'owner', 'update': 'owner', 'delete': 'owner'}
    live = dict(json.loads(json.dumps(base_live)), access=dict(lock))
    arch = dict(json.loads(json.dumps(base_arch)), access=dict(lock)); arch.pop('rateLimit', None)
    arch.setdefault('fields', {})['mv'] = {'type': 'string', 'maxLength': 40}
    arch['fields'].setdefault('oc', {'type': 'number', 'minimum': 0}); arch['fields'].setdefault('src', {'type': 'string', 'maxLength': 40})
    return live, arch


def cmd_rotate_declare(apply_):
    n, old = need_names(), family(); p, m = _manifest(); cols = m['collections']
    if n['live'] in cols and n['archive'] in cols: print('already declared (nothing to do)'); return
    live, arch = _new_defs(cols, old)
    cols[n['live']] = live; cols[n['archive']] = arch
    if len(cols) > 10: sys.exit('too many collections')
    out = json.dumps(m, indent=2) + '\n'
    if len(out) > 64000: sys.exit('manifest too large')
    print(f'plan: add 2 owner-only collections (new live, new archive); {len(cols)} collections after; old ones unchanged')
    if not apply_: print('DRY RUN: nothing written. Add --apply.'); return
    d = private_dir(ROTATE_DIR); bk = os.path.join(d, 'manifest-before-rotate.json')
    if not os.path.exists(bk): shutil.copyfile(p, bk); os.chmod(bk, 0o600)
    open(p, 'w').write(out)
    n['step'] = max(n.get('step', 0), STEP['declared']); save_names(n)
    print('manifest written (saved the previous one for rollback). Publish the site, then run `rotate copy`.')


def plan_copy(srcs, dest, tag):
    """Pure: records to insert into `dest` (an archive). srcs = [(prefix, records, archived)]. Each copy keeps its
    original server time in `oc` (archive records keep their own `oc`) and is marked `mv` = prefix + source id."""
    have = {r.get('data', {}).get('mv') for r in dest}
    todo, skipped = [], 0
    for prefix, recs, archived in srcs:
        for r in recs:
            mv = prefix + str(r['id'])
            if len(mv) > 40: sys.exit('STOP: a record id is too long for the mv marker')
            if mv in have: skipped += 1; continue
            d = {k: v for k, v in r.get('data', {}).items() if k in ('uid', 'un', 'av', 'season', 'week', 'picks', 'bf', 'ts', 'app', 'src')}
            oc = r['data'].get('oc') if archived and isinstance(r['data'].get('oc'), (int, float)) and r['data']['oc'] > 0 else ms(r['createdAt'])
            todo.append(dict(d, oc=int(oc), mv=mv))
    return todo, skipped


def _copy(apply_, srcs_pairs, dest, bdir, tag, note):
    if not apply_:
        recs = []
        for label, c, prefix, archived in srcs_pairs:
            r = list_all(c)
            if r is None: sys.exit(f'STOP: {label} collection returned 404 (not active)')
            recs.append((prefix, r, archived))
        dst = list_all(dest)
        if dst is None: sys.exit('STOP: the destination archive is not active yet (publish the manifest first)')
        todo, skipped = plan_copy(recs, dst, tag)
        print(f"plan: {', '.join(f'{lbl} {len(r)}' for (lbl, *_), (_, r, _) in zip(srcs_pairs, recs))} records; already copied {skipped}; to copy {len(todo)}")
        print('DRY RUN: nothing written. Add --apply (it takes a backup first).'); return None
    got = backup_collections(bdir, [(label, c) for label, c, _, _ in srcs_pairs] + [('dest-archive', dest)], note)
    todo, skipped = plan_copy([(prefix, got[label], archived) for label, _, prefix, archived in srcs_pairs], got['dest-archive'], tag)
    ok = 0
    for rec in todo:
        st, j = owner('POST', dest, rec, key=tag + rec['mv'])
        if st not in (200, 201): sys.exit(f'copy stopped after {ok}: HTTP {st} {j.get("code", "")}')
        ok += 1
    print(f'copied {ok}; already there {skipped}')
    return ok


def cmd_rotate_copy(apply_, bdir):
    n, old = need_names(), family()
    r = _copy(apply_, [('old-live', old['live'], 'l-', False), ('old-archive', old['archive'], 'a-', True)], n['archive'], bdir,
              'rot-', 'cleanup: delete this backup folder once the rotation is verified (it holds everyone\'s picks)')
    if r is not None:
        n['step'] = max(n.get('step', 0), STEP['copied']); save_names(n)
        print('next: set LB_LIVE / LB_ARCHIVE with `rotate secret`, deploy the Worker, re-run copy to catch up, then `rotate close`')


def cmd_rotate_close(apply_):
    n, old = need_names(), family(); p, m = _manifest(); cols = m['collections']
    if n['live'] not in cols or n['archive'] not in cols: sys.exit('STOP: the new collections are not declared')
    present = [k for k in ('live', 'archive') if old[k] in cols]
    if not present: print('old names already removed (nothing to do)'); return
    srcs = []
    for k, prefix, archived in (('live', 'l-', False), ('archive', 'a-', True)):
        r = list_all(old[k])
        if r is None: sys.exit(f'STOP: old {k} is not readable; cannot confirm the copy is complete')
        srcs.append((prefix, r, archived))
    dst = list_all(n['archive'])
    if dst is None: sys.exit('STOP: the new archive is not active')
    todo, _ = plan_copy(srcs, dst, 'rot-')
    if todo: sys.exit(f'STOP: {len(todo)} old record(s) are not copied yet; run `rotate copy --apply` first')
    print(f'plan: remove {len(present)} old password-derived collection(s) from the manifest; every old record is copied')
    if not apply_: print('DRY RUN: nothing written. Add --apply.'); return
    for k in present: cols.pop(old[k])
    open(p, 'w').write(json.dumps(m, indent=2) + '\n')
    n['step'] = STEP['closed']; save_names(n)
    print('manifest written. Publish the site, run `rotate verify`, then rotate the family password (LB_PASSWORD).')


def same_404(results):
    """Pure: results = [(status, body_text)] for old live, old archive and a never-used name (names already blanked)."""
    return len({(s, b) for s, b in results}) == 1 and results[0][0] == 404


def _public_get(slug, name):
    u = f'https://{slug}.here.now/.herenow/data/{name}'
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'gg-tools'})) as r: return r.status, r.read().decode('utf-8', 'replace').replace(name, '<name>')
    except urllib.error.HTTPError as e: return e.code, e.read().decode('utf-8', 'replace').replace(name, '<name>')


def cmd_rotate_verify(get=None):
    get = get or _public_get; old = family(); slug = CFG['siteSlug']
    res = [get(slug, old['live']), get(slug, old['archive']), get(slug, 'gg' + secrets.token_hex(NAME_BYTES))]
    for label, (st, _) in zip(('old live', 'old archive', 'never-used name'), res): print(f'{label}: HTTP {st}')
    if not same_404(res): sys.exit('MISMATCH: the old names do not answer exactly like a never-used name yet. Do not rotate the password until they do.')
    print('SAME: the old names answer exactly like a name that never existed')


def cmd_rotate_rollback(apply_):
    n = need_names(); p = manifest_path(); bk = os.path.join(ROTATE_DIR, 'manifest-before-rotate.json')
    if not os.path.exists(bk): sys.exit('STOP: no saved manifest (rotate declare --apply never ran)')
    print('plan: put back the manifest saved before `rotate declare` (old names live again, new ones undeclared). '
          'Then point LB_LIVE/LB_ARCHIVE back at the old names and redeploy, and run `rotate copy-back`.')
    if not apply_: print('DRY RUN: nothing written. Add --apply.'); return
    shutil.copyfile(bk, p)
    n['step'] = STEP['rolled_back']; save_names(n)
    print('manifest restored. Publish the site.')


def cmd_rotate_copy_back(apply_, bdir):
    n, old = need_names(), family()
    _copy(apply_, [('new-live', n['live'], 'r-', False)], old['archive'], bdir, 'back-',
          'cleanup: delete this backup folder once the rollback is verified (it holds everyone\'s picks)')


def cmd_rotate(a):
    sub = a[1] if len(a) > 1 else ''; apply_ = '--apply' in a; bdir = _arg(a, '--backup-dir') or ROTATE_DIR
    f = {'new': cmd_rotate_new, 'secret': lambda: cmd_rotate_secret(a), 'declare': lambda: cmd_rotate_declare(apply_),
         'copy': lambda: cmd_rotate_copy(apply_, bdir), 'close': lambda: cmd_rotate_close(apply_), 'verify': cmd_rotate_verify,
         'rollback': lambda: cmd_rotate_rollback(apply_), 'copy-back': lambda: cmd_rotate_copy_back(apply_, bdir)}.get(sub)
    if not f: sys.exit('usage: rotate new|secret|declare|copy|close|verify|rollback|copy-back [--apply]')
    f()


# ---------------- Worker D1 admin (P2-1 reset by owner, P2-2 alerts, P2-3 revoke) ----------------
UID_RE = re.compile(r'^\d{1,24}$')


def lb_admin_sql(a):
    sub = a[1] if len(a) > 1 else ''
    if sub == 'alerts': return 'SELECT k, n, first, last FROM lbalert ORDER BY last DESC LIMIT 20'
    if sub == 'revoke-all': return 'DELETE FROM lblink; DELETE FROM lbtokens'
    if sub == 'revoke-uid':
        uid = a[2] if len(a) > 2 else ''
        if not UID_RE.match(uid): sys.exit('usage: lb-admin revoke-uid <numeric Sleeper user id>')
        return f"DELETE FROM lblink WHERE uid = '{uid}'; DELETE FROM lbtokens WHERE uid = '{uid}'"
    sys.exit('usage: lb-admin alerts|revoke-uid UID|revoke-all [--apply]')


def cmd_lb_admin(a, run=None):
    sql = lb_admin_sql(a)
    cmd = ['npx', 'wrangler', 'd1', 'execute', 'gg-caps', '--remote', '--command', sql]
    if '--apply' not in a and a[1] != 'alerts':
        print('DRY RUN. In worker/, this would run:\n  ' + ' '.join(cmd[:-1]) + f' "{sql}"\nAdd --apply to run it.'); return
    (run or subprocess.run)(cmd, cwd=os.path.join(ROOT, 'worker'), check=True)


if __name__ == '__main__':
    a = sys.argv[1:] or ['help']; dry = '--dry-run' in a
    {'manifest': lambda: cmd_manifest(dry, '--owner-only' in a), 'migrate': lambda: cmd_migrate(dry), 'status': cmd_status, 'keys': cmd_keys,
     'backup': lambda: cmd_backup(a[1] if len(a) > 1 else None), 'fix-late-week': lambda: cmd_fix_late_week(a),
     'rotate': lambda: cmd_rotate(a), 'lb-admin': lambda: cmd_lb_admin(a)}.get(a[0], lambda: print(__doc__))()
