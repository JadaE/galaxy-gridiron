#!/usr/bin/env python3
"""v0.0.12 family leaderboard tooling (box only). Never prints the password or the derived collection names.

The app derives the family collections from the shared password (app/src/picks/family.ts):
  live    = "gg" + sha256(SALT + "\\n" + password)[:40]   (public read + insert, like the old picks collection)
  archive = live + "_a"                                   (public read, OWNER insert: picks copied from the old collection,
                                                           each with its original server time in `oc`)
The password comes ONLY from $GG_LEADERBOARD_PASSWORD.

  python3 tools/leaderboard.py keys                # write keys/family-collections.json (chmod 600) so the secret checks know the names
  python3 tools/leaderboard.py manifest [--dry-run] # declare live + archive in <publishSiteDir>/.herenow/data.json and close the
                                                    # OLD picks collection (read owner, insert none). The feedback block is untouched.
  python3 tools/leaderboard.py migrate [--dry-run]  # copy every OLD picks record into the archive with the owner API
                                                    # (idempotent: skips records already copied). Needs the new manifest LIVE.
  python3 tools/leaderboard.py status               # record counts: old / archive / live (owner API)
  python3 tools/leaderboard.py backup [DIR]         # owner read of old / archive / live into DIR (default /workspace/gg-private-backups/jc17,
                                                    # outside the repo; folder 700, files 600). Read-only on the server.
                                                    # CLEANUP: delete the JC-17 backups once JC-17 is closed (they hold everyone's picks).
  python3 tools/leaderboard.py fix-late-week --source-id REC_ID [--from-backup DIR] [--games FILE] [--out FILE]
                                                    [--apply] | [--rollback [--apply]]
      JC-17 ONLY: one-time, OWNER-APPROVED correction. PINNED to season 2026, week 9 and one user whose id is read from
      $GG_JC17_UID or app/config.local.json "jc17Uid" (gitignored) and must match the hash below; any other value is refused.
      --source-id must equal the one live record found for that user+week (the owner confirms it from the dry run).
      Dry run by default (prints the record id, every pick, kickoffs and oc). --apply inserts ONE owner-only archive record
      (src "fix-<source id>") with that week's picks, `oc` = 1 minute before the earliest corrected kickoff. Idempotent.
      --rollback plans the removal of exactly that record (exact src + season + user + week, exactly one match);
      --rollback --apply deletes it. The late live record is never changed; no app rule trusts phone clocks.
Needs: app/config.local.json (siteSlug, picksCollection, publishSiteDir) and $HERENOW_API_KEY for migrate/status/backup/fix-late-week\n(fix-late-week dry run with --from-backup and --games needs no key).
"""
import hashlib, json, os, sys, time, glob, urllib.request, urllib.error
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


def cmd_manifest(dry):
    f, p = family(), manifest_path()
    m = json.load(open(p)); cols = m['collections']; old = CFG['picksCollection']
    if old not in cols: sys.exit('old picks collection is not in the manifest')
    base = json.loads(json.dumps(cols[old]))
    live = dict(base, access={'read': 'public', 'insert': 'public', 'update': 'owner', 'delete': 'owner'})
    arch = json.loads(json.dumps(base)); arch['fields']['oc'] = {'type': 'number', 'minimum': 0}; arch['fields']['src'] = {'type': 'string', 'maxLength': 40}
    arch['access'] = {'read': 'public', 'insert': 'owner', 'update': 'owner', 'delete': 'owner'}; arch.pop('rateLimit', None)
    cols[f['live']] = live; cols[f['archive']] = arch
    cols[old]['access'] = {'read': 'owner', 'insert': 'none', 'update': 'owner', 'delete': 'owner'}
    if len(cols) > 10: sys.exit('too many collections')
    out = json.dumps(m, indent=2) + '\n'
    if len(out) > 64000: sys.exit('manifest too large')
    if dry: print(f'manifest OK (dry run): {len(cols)} collections; old picks -> read owner / insert none; feedback untouched'); return
    open(p, 'w').write(out)
    print(f'manifest written: {len(cols)} collections (old picks closed to new writes and public reads; feedback block unchanged)')


def cmd_keys():
    f = family(); p = os.path.join(ROOT, 'keys', 'family-collections.json')
    with open(os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as fh: json.dump({'live': f['live'], 'archive': f['archive']}, fh)
    os.chmod(p, 0o600); print('wrote keys/family-collections.json (600)')


def cmd_status():
    f = family()
    for label, c in (('old', CFG['picksCollection']), ('archive', f['archive']), ('live', f['live'])):
        r = list_all(c); print(f'{label}: ' + ('not active (manifest not published yet)' if r is None else f'{len(r)} records'))


def cmd_migrate(dry):
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


def cmd_backup(d):
    f = family(); d = os.path.abspath(d or BACKUP_DIR)
    if d == ROOT or d.startswith(ROOT + os.sep): sys.exit('backups must go outside the repo')
    os.makedirs(d, mode=0o700, exist_ok=True); os.chmod(d, 0o700); stamp = time.strftime('%Y%m%d-%H%M')
    for label, c in (('old', CFG['picksCollection']), ('archive', f['archive']), ('live', f['live'])):
        r = list_all(c) or []
        p = os.path.join(d, f'picks-{label}-{stamp}.json')
        with open(os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as fh: json.dump(r, fh)
        os.chmod(p, 0o600); print(f'{label}: {len(r)} records -> picks-{label}-{stamp}.json (600)')
    print('cleanup: delete this folder once JC-17 is closed')


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
    if _arg(a, '--games'):
        g = json.load(open(_arg(a, '--games')))
        sched = {str(k): (v if isinstance(v, dict) else {'k': int(v), 'away': '?', 'home': '?'}) for k, v in g.items()}
    else: sched = espn_week(season, week)
    kick = {k: v['k'] for k, v in sched.items()}
    if bdir: live, arch, where = _latest(bdir, 'live'), _latest(bdir, 'archive'), 'backup'
    else:
        f = family(); live, arch, where = list_all(f['live']), list_all(f['archive']), 'server (read-only)'
        if live is None or arch is None: sys.exit('live/archive collection not active')
    print(f'read from {where}: live {len(live)} records, archive {len(arch)} records')
    if rollback:
        r = plan_rollback(arch, uid, season, week, src_id)
        if not r['ok']: sys.exit('STOP: ' + r['why'])
        print(f"rollback plan: delete archive record {r['id']} (src {r['tag']}, season {season}, week {week})")
        if not apply_: print('DRY RUN: nothing deleted. Add --apply to delete exactly that record.'); return
        st, j = owner('DELETE', f"{family()['archive']}/{r['id']}")
        if st not in (200, 204): sys.exit(f'delete failed: HTTP {st} {j.get("code", "")}')
        print(f"deleted 1 archive record {r['id']}"); return
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
    st, j = owner('POST', family()['archive'], rec, key=rec['src'])
    if st not in (200, 201): sys.exit(f'insert failed: HTTP {st} {j.get("code", "")}')
    print(f"inserted 1 archive record {j.get('id', j.get('record', {}).get('id', '?'))}; re-run without --apply to confirm 'already applied'")


if __name__ == '__main__':
    a = sys.argv[1:] or ['help']; dry = '--dry-run' in a
    {'manifest': lambda: cmd_manifest(dry), 'migrate': lambda: cmd_migrate(dry), 'status': cmd_status, 'keys': cmd_keys,
     'backup': lambda: cmd_backup(a[1] if len(a) > 1 else None), 'fix-late-week': lambda: cmd_fix_late_week(a)}.get(a[0], lambda: print(__doc__))()
