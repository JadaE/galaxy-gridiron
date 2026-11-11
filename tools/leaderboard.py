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
  python3 tools/leaderboard.py manifest --owner-only [--dry-run]
                                                    # JC-34 cut-over: live + archive become read OWNER / insert OWNER, so only
                                                    # the Worker (owner API key) can read or write them and the old apps' password
                                                    # probe stops working. Run ONLY after the Worker's /lb routes are deployed.
  python3 tools/leaderboard.py migrate [--dry-run]  # copy every OLD picks record into the archive with the owner API
                                                    # (idempotent: skips records already copied). Needs the new manifest LIVE.
  python3 tools/leaderboard.py status               # record counts: old / archive / live (owner API)
  python3 tools/leaderboard.py backup DIR           # owner read of old / archive / live into DIR (files chmod 600). Read-only.
  python3 tools/leaderboard.py fix-late-week --uid UID --week W [--season S] [--late-games ID,ID] [--from-backup DIR]
                                                    [--games FILE] [--out FILE] [--apply | --rollback]
      One-time, OWNER-APPROVED correction for ONE user and ONE week whose picks were made on time in the app (live mode,
      no backfill flags) but reached the server after kickoff. Dry run by default. --apply inserts ONE owner-only archive
      record (src "fix-<live record id>") holding that week's picks minus --late-games, with `oc` = 1 minute before the
      earliest kickoff among them. Idempotent (an existing record with that src = nothing to do). --rollback deletes it.
      Nothing else is read-modified: the late live record stays as it is; no app rule trusts phone clocks.
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


def cmd_manifest(dry, owner_only=False):
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


def cmd_backup(d):
    f = family(); os.makedirs(d, mode=0o700, exist_ok=True); stamp = time.strftime('%Y%m%d-%H%M')
    for label, c in (('old', CFG['picksCollection']), ('archive', f['archive']), ('live', f['live'])):
        r = list_all(c) or []
        p = os.path.join(d, f'picks-{label}-{stamp}.json')
        with open(os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as fh: json.dump(r, fh)
        os.chmod(p, 0o600); print(f'{label}: {len(r)} records -> picks-{label}-{stamp}.json (600)')


def espn_kickoffs(season, week):
    u = f'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week={week}&seasontype=2&dates={season}'
    with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'gg-tools'})) as r: j = json.load(r)
    return {str(e['id']): ms(e['date']) for e in j.get('events', [])}


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


def cmd_fix_late_week(a):
    uid, week = _arg(a, '--uid'), _arg(a, '--week')
    if not uid or not week: sys.exit('need --uid and --week')
    week, season = int(week), int(_arg(a, '--season', '2026'))
    late_games = [x for x in (_arg(a, '--late-games', '') or '').split(',') if x]
    apply_, rollback, bdir = '--apply' in a, '--rollback' in a, _arg(a, '--from-backup')
    if (apply_ or rollback) and bdir: sys.exit('--apply/--rollback read the live server, not a backup')
    kick = {str(k): int(v) for k, v in json.load(open(_arg(a, '--games'))).items()} if _arg(a, '--games') else espn_kickoffs(season, week)
    if bdir: live, arch, where = _latest(bdir, 'live'), _latest(bdir, 'archive'), 'backup'
    else:
        f = family(); live, arch, where = list_all(f['live']), list_all(f['archive']), 'server'
        if live is None or arch is None: sys.exit('live/archive collection not active')
    if rollback:
        tag_ids = [x['id'] for x in arch if str(x.get('data', {}).get('src', '')).startswith('fix-') and x['data'].get('uid') == uid and x['data'].get('week') == week]
        print(f'rollback: {len(tag_ids)} fix record(s) for this user+week: {tag_ids}')
        for i in tag_ids:
            st, j = owner('DELETE', f"{family()['archive']}/{i}")
            print(f'  delete {i}: HTTP {st}')
        return
    p = plan_fix(live, arch, kick, uid, season, week, late_games)
    hhmm = lambda t: datetime.fromtimestamp(t / 1000).strftime('%a %b %d %I:%M %p')
    print(f'read from {where}: live {len(live)} records, archive {len(arch)} records')
    if not p['ok']: sys.exit('STOP: ' + p['why'])
    if p.get('noop'): print(f"nothing to do: {p['why']} (source {p['source']})"); return
    print(f"source live record: {p['source']} (server time {hhmm(p['source_created'])}, {len(p['record']['picks']) + len(p['late']) + len(p['already_on_time'])} picks)")
    print(f"  -> on time (into archive record): {len(p['fix'])}   kept late (stay backfilled): {len(p['late'])} {p['late']}   already on time: {len(p['already_on_time'])}")
    if p['not_picked_late']: print(f"  late games with no pick in the record (nothing to mark): {p['not_picked_late']}")
    print(f"  archive record: src={p['record']['src']} oc={hhmm(p['record']['oc'])} (1 min before the earliest corrected kickoff)")
    if _arg(a, '--out'):
        o = _arg(a, '--out')
        with open(os.open(o, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as fh: json.dump(p['record'], fh)
    if not apply_: print('DRY RUN: nothing written. Add --apply to insert the 1 archive record.'); return
    st, j = owner('POST', family()['archive'], p['record'], key=p['record']['src'])
    if st not in (200, 201): sys.exit(f'insert failed: HTTP {st} {j.get("code", "")}')
    print(f"inserted 1 archive record {j.get('id', j.get('record', {}).get('id', '?'))}; re-run without --apply to confirm 'already applied'")


if __name__ == '__main__':
    a = sys.argv[1:] or ['help']; dry = '--dry-run' in a
    {'manifest': lambda: cmd_manifest(dry, '--owner-only' in a), 'migrate': lambda: cmd_migrate(dry), 'status': cmd_status, 'keys': cmd_keys,
     'backup': lambda: cmd_backup(a[1] if len(a) > 1 else sys.exit('need DIR')), 'fix-late-week': lambda: cmd_fix_late_week(a)}.get(a[0], lambda: print(__doc__))()
