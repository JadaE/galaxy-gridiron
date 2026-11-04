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
Needs: app/config.local.json (siteSlug, picksCollection, publishSiteDir) and $HERENOW_API_KEY for migrate/status.
"""
import hashlib, json, os, sys, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, 'app', 'config.local.json')))
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
        from datetime import datetime
        d['oc'] = int(datetime.fromisoformat(r['createdAt'].replace('Z', '+00:00')).timestamp() * 1000); d['src'] = r['id']
        st, j = owner('POST', f['archive'], d, key='mig-' + r['id'])
        if st in (200, 201): ok += 1
        else: sys.exit(f'copy stopped after {ok}: HTTP {st} {j.get("code", "")}')
    after = list_all(f['archive'])
    print(f'copied {ok}; archive now {len(after)} records (old: {len(old)})')


if __name__ == '__main__':
    a = sys.argv[1:] or ['help']; dry = '--dry-run' in a
    {'manifest': lambda: cmd_manifest(dry), 'migrate': lambda: cmd_migrate(dry), 'status': cmd_status, 'keys': cmd_keys}.get(a[0], lambda: print(__doc__))()
