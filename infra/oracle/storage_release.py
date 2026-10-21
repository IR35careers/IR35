"""Metadata-only release selection. Never starts Storage or runs migrations."""
import base64
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile
import urllib.request

import cloud_schema as schema
import owner_parity
import rehearsal
import pin_staging_images
import storage_diagnose

UPSTREAM = 'https://github.com/supabase/storage.git'
PACKAGE = 'https://registry.npmjs.org/postgres-migrations/-/postgres-migrations-5.3.0.tgz'
INTEGRITY = 'gnTHWJZVWbW8T3mXIxJm1JRU853TqBVWkhgfsTJr7zqT3VexjRmJj9kNi96rVhfTezDU4FVW6pf701kLOZiKIA=='
CACHE = Path.home() / '.cache/ir35-storage-upstream'
SOURCE_REPORT = schema.REPO / 'docs/evidence/oracle-p4-storage-exported-history.json'
REPORT = schema.REPO / 'docs/evidence/oracle-p4-storage-release-search.json'
PIN = schema.REPO / 'infra/oracle/storage-compatible-image.json'
FIXTURE_REPORT = schema.REPO / 'docs/evidence/oracle-p4-storage-image-fixture.json'

EXPORT = r'''
name='ir35_rehearsal_a_20261021'
entry=json.loads((ROOT/'config/p4-rehearsal.json').read_text())['cycles']['1']
if entry.get('target')!=name or entry.get('customerData') is not True or entry.get('storageAPIAttempts')!=1:
 raise RuntimeError('Quarantined owned snapshot identity required')
path=ROOT/'.env.p4-cycle1-source.json';info=path.lstat()
if not stat.S_ISREG(info.st_mode) or info.st_uid!=1002 or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1:
 raise RuntimeError('Private snapshot custody required')
raw=path.read_bytes()
if hashlib.sha256(raw).hexdigest()!=entry.get('sourceBundleSHA256'):
 raise RuntimeError('Private snapshot hash mismatch; STOP')
source=json.loads(raw)
table=next(t for t in source['rows']['inventory']['tables'] if t['schema']=='storage' and t['name']=='migrations')
expected=next(t for t in source['rows']['tables'] if t['name']=='storage.migrations')
args=base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',name,'-f','-']
value=fingerprint(args,{'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C.UTF-8'},'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; '+SETTINGS+copy_sql(table)+' ROLLBACK;')
if {'name':'storage.migrations',**value}!=expected:
 raise RuntimeError('Export-bound storage.migrations fingerprint mismatch; STOP')
sql="BEGIN READ ONLY; SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'hash',hash) ORDER BY id) FROM storage.migrations; ROLLBACK;"
result=subprocess.run(args,input=sql,capture_output=True,text=True,timeout=30)
if result.returncode:raise RuntimeError('Read-only migration metadata export failed; raw output withheld')
rows=json.loads(result.stdout)
print(json.dumps({'status':'PASS','archiveSHA256':entry['archiveSHA256'],'sourceBundleSHA256':entry['sourceBundleSHA256'],
 'tableFingerprint':expected,'migrations':rows,'sourceWrites':0,'stagingWrites':0,'apiStarted':False,'migrationRunnerCalled':False}))
'''


def validate_rows(rows):
    if not isinstance(rows, list) or not rows:
        raise ValueError('Nonempty migration metadata required')
    ids, names = set(), set()
    for row in rows:
        if (not isinstance(row, dict) or set(row) != {'id', 'name', 'hash'}
                or type(row['id']) is not int or row['id'] < 0
                or not isinstance(row['name'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', row['name'])
                or not isinstance(row['hash'], str) or not re.fullmatch(r'[a-f0-9]{40}', row['hash'])
                or row['id'] in ids or row['name'] in names):
            raise ValueError('Invalid or duplicate migration metadata')
        ids.add(row['id']); names.add(row['name'])
    if ids != set(range(len(rows))):
        raise ValueError('Contiguous migration IDs required')
    return sorted(rows, key=lambda row: row['id'])


def file_row(filename, contents):
    match = re.fullmatch(r'(\d+)[-_](.+)\.sql', filename)
    if not match:
        raise ValueError('SQL migration filename required')
    # postgres-migrations 5.3.0 hashes the basename + exact UTF8 SQL, not Git's blob hash.
    contents.decode('utf-8', errors='strict')
    return {'id': int(match[1]), 'name': match[2],
            'hash': hashlib.sha1(filename.encode('utf-8') + contents).hexdigest()}


def compare(applied, intended):
    applied, intended = validate_rows(applied), validate_rows(intended)
    a, b = {row['id']: row for row in applied}, {row['id']: row for row in intended}
    changed = [{'id': key, 'cloud': a[key], 'release': b[key]}
               for key in sorted(a.keys() & b.keys()) if a[key] != b[key]]
    missing = [a[key] for key in sorted(a.keys() - b.keys())]
    pending = [b[key] for key in sorted(b.keys() - a.keys())]
    return {'status': 'PASS' if not (changed or missing or pending) else 'FAIL',
            'altered': changed, 'missing': missing, 'pending': pending}


def summarize_releases(releases):
    """Retain every tag's verdict without publishing hundreds of repeated SQL histories."""
    output = []
    for row in releases:
        summary = {key: row[key] for key in ('tag', 'commit', 'status', 'migrationCount', 'missingId') if key in row}
        if 'altered' in row:
            summary.update(alteredIds=[item['id'] for item in row['altered']],
                           missingIds=[item['id'] for item in row['missing']],
                           pendingIds=[item['id'] for item in row['pending']])
        output.append(summary)
    return output


def git(*args):
    result = subprocess.run(['git', '-C', str(CACHE), *args], capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError('Public upstream Git metadata read failed')
    return result.stdout


def package_files():
    with urllib.request.urlopen(PACKAGE, timeout=30) as response:
        payload = response.read(2_000_001)
    if len(payload) > 2_000_000 or base64.b64encode(hashlib.sha512(payload).digest()).decode() != INTEGRITY:
        raise RuntimeError('Migration library lockfile integrity mismatch')
    with tarfile.open(fileobj=io.BytesIO(payload), mode='r:gz') as archive:
        loader = archive.extractfile('package/dist/migration-file.js').read()
        initial = archive.extractfile('package/dist/migrations/0_create-migrations-table.sql').read()
    if b'hashString(fileName + sql)' not in loader:
        raise RuntimeError('Unsupported upstream hash algorithm')
    return file_row('0_create-migrations-table.sql', initial), hashlib.sha256(loader).hexdigest()


def export():
    script = schema.guest_bundle(rehearsal=True) + owner_parity.BASE + rehearsal.verification_modules() + EXPORT
    result = schema.run_guest(script, timeout=100)
    validate_rows(result['migrations'])
    if result['status'] != 'PASS' or len(result['migrations']) != 74:
        raise RuntimeError('Expected export-bound 74-row migration history')
    SOURCE_REPORT.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'status': 'PASS', 'operation': 'export-metadata', 'rows': 74,
                      'sourceWrites': 0, 'stagingWrites': 0}))


def search():
    source = json.loads(SOURCE_REPORT.read_text())
    applied = validate_rows(source['migrations'])
    if source.get('status') != 'PASS' or git('remote', 'get-url', 'origin').decode().strip() != UPSTREAM:
        raise RuntimeError('Verified export / exact public upstream required')
    initial, loader_hash = package_files()
    tags = [tag for tag in git('tag', '--list').decode().splitlines() if re.fullmatch(r'v\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?', tag)]
    if not tags:
        raise RuntimeError('Upstream release tags missing')
    blobs, releases = {}, []
    for tag in tags:
        entries = git('ls-tree', '-r', tag, '--', 'migrations/tenant').decode().splitlines()
        # A release without the cloud's final migration is already ineligible;
        # do not fetch every historical SQL blob merely to rediscover that.
        final = applied[-1]
        if not any(line.endswith('/'+str(final['id']).zfill(4)+'-'+final['name']+'.sql') for line in entries):
            releases.append({'tag': tag, 'status': 'INELIGIBLE_MISSING_CLOUD_FINAL_MIGRATION',
                             'missingId': final['id'], 'migrationCount': len(entries)+1})
            continue
        rows = [initial]
        for line in entries:
            header, path = line.split('\t'); mode, kind, blob = header.split()
            if mode != '100644' or kind != 'blob' or not path.endswith('.sql'):
                raise RuntimeError('Unexpected upstream migration entry')
            filename = Path(path).name
            if blob not in blobs:
                blobs[blob] = git('cat-file', 'blob', blob)
            rows.append(file_row(filename, blobs[blob]))
        if len(rows) == 1:
            releases.append({'tag': tag, 'status': 'INELIGIBLE_NO_TENANT_DIRECTORY'})
            continue
        result = compare(applied, rows)
        releases.append({'tag': tag, 'commit': git('rev-parse', tag+'^{commit}').decode().strip(),
                         'migrationCount': len(rows), **result})
    matches = [row for row in releases if row['status'] == 'PASS']
    report = {'status': 'PASS' if matches else 'FAIL_NO_EXACT_RELEASE',
              'checkedAt': datetime.now(timezone.utc).isoformat(), 'upstream': UPSTREAM,
              'archiveSHA256': source['archiveSHA256'], 'sourceBundleSHA256': source['sourceBundleSHA256'],
              'cloudMigrations': applied, 'hashAlgorithm': 'sha1(basename + exact UTF8 SQL)',
              'library': 'postgres-migrations@5.3.0', 'loaderSHA256': loader_hash,
              'tagsChecked': len(tags), 'matchingReleases': [row['tag'] for row in matches],
              'releases': summarize_releases(releases),
              'closestCandidates': sorted((row for row in releases if 'altered' in row),
                  key=lambda row: (len(row['altered']) + len(row['missing']) + len(row['pending']), row['tag']))[:5],
              'sourceWrites': 0, 'stagingWrites': 0,
              'apiStarted': False, 'imagePinChanged': False, 'migrationRunnerCalled': False,
              'phaseComplete': False}
    REPORT.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ('status', 'tagsChecked', 'matchingReleases', 'sourceWrites', 'stagingWrites', 'apiStarted')}))


def pin_candidate():
    release = 'v1.80.2'
    report = json.loads(REPORT.read_text())
    if report.get('status') != 'PASS' or release not in report.get('matchingReleases', []):
        raise RuntimeError('Exact source release compatibility required before manifest lookup')
    commit = git('rev-parse', release+'^{commit}').decode().strip()
    image = pin_staging_images.resolve('supabase/storage-api', release)
    result = {'status':'ARM64_MANIFEST_VERIFIED', 'release':release, 'sourceCommit':commit,
              'image':image, 'sourceBuildRequired':False, 'apiStarted':False,
              'migrationFixtureVerified':False}
    PIN.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result))


def image_fixture():
    pin = json.loads(PIN.read_text())
    if pin.get('status') != 'ARM64_MANIFEST_VERIFIED' or pin['image'].get('platform') != 'linux/arm64':
        raise RuntimeError('Verified native ARM64 digest required')
    script = r'''
pin=PIN
run(['docker','pull','--platform','linux/arm64',pin['image']],timeout=180)
config=json.loads(run(['docker','image','inspect',pin['image']]))[0]
if config.get('Architecture')!='arm64' or config.get('Os')!='linux':raise RuntimeError('Pulled image native platform mismatch')
result=subprocess.run(['docker','run','--rm','--network','none','--read-only','--memory','128m','--pids-limit','64','--cap-drop','ALL','--security-opt','no-new-privileges','--log-driver','none','--user','1002:1002','--entrypoint','node',pin['image'],'-e',JS],capture_output=True,text=True,timeout=40)
if result.returncode:raise RuntimeError('Native image metadata fixture failed; no database connection or API start')
print(json.dumps({'migrations':json.loads(result.stdout),'nativePlatform':'linux/arm64','apiStarted':False,'sourceWrites':0,'stagingWrites':0}))
'''
    replacements = {'PIN':repr(pin['image']), 'JS':repr(storage_diagnose.MIGRATION_JS)}
    script = re.sub(r'\b(PIN|JS)\b', lambda match: replacements[match[0]], script)
    result = schema.run_guest(schema.guest_bundle(rehearsal=True)+owner_parity.BASE+script, timeout=260)
    source = json.loads(SOURCE_REPORT.read_text())
    comparison = compare(source['migrations'], result['migrations'])
    result.update(comparison, image=pin['image'], sourceCommit=pin['sourceCommit'],
                  archiveSHA256=source['archiveSHA256'], phaseComplete=False)
    FIXTURE_REPORT.write_text(json.dumps(result, indent=2)+'\n')
    if comparison['status'] != 'PASS':
        raise RuntimeError('Native image migrations mismatch; no API/restore allowed')
    pin['migrationFixtureVerified'] = True
    PIN.write_text(json.dumps(pin, indent=2)+'\n')
    print(json.dumps({'status':'PASS','migrations':len(result['migrations']), 'altered':0,'missing':0,'pending':0,
                      'nativePlatform':'linux/arm64','apiStarted':False}))


if __name__ == '__main__':
    import sys
    try:
        if sys.argv[1:] == ['--export-metadata']:
            export()
        elif sys.argv[1:] == ['--search-releases']:
            search()
        elif sys.argv[1:] == ['--pin-candidate']:
            pin_candidate()
        elif sys.argv[1:] == ['--image-fixture']:
            image_fixture()
        else:
            raise ValueError('Choose metadata export or public release search only')
    except Exception as error:
        print(json.dumps({'status': 'FAIL', 'code': type(error).__name__, 'rawOutput': 'withheld'}))
        raise SystemExit(1)
