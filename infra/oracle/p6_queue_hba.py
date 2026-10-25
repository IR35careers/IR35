"""Owner-approved queue-login boundary; no role/ACL/catalog changes."""
import re

ROLES = ('ir35_queue', 'ir35_queue_producer')
QUEUE_DATABASE = 'postgres'
BEGIN = '# BEGIN IR35 P6 OWNER-APPROVED QUEUE CONNECTION BOUNDARY'
END = '# END IR35 P6 OWNER-APPROVED QUEUE CONNECTION BOUNDARY'


def database_name(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]{0,62}', value):
        raise ValueError('UnexpectedDatabaseIdentifier_NoHBAWrite')
    return value


def rules(databases):
    names = sorted(database_name(name) for name in databases)
    if len(names) != len(set(names)) or QUEUE_DATABASE not in names:
        raise ValueError('CompleteUniqueDatabaseInventoryRequired')
    if 'ir35_p5_app' not in names or not any(name.startswith('ir35_p4_') for name in names):
        raise ValueError('ApplicationAndPristineInventoryRequired')
    users = ','.join(ROLES)
    rows = []
    # Specific per-database rejects precede BOTH queue allows and old/general
    # rules. Quoted DB names are literal, never all/replication keywords.
    for name in names:
        if name != QUEUE_DATABASE:
            rows += [f'local "{name}" {users} reject', f'host "{name}" {users} all reject']
    rows += [f'local "postgres" {users} scram-sha-256',
             f'host "postgres" {users} all scram-sha-256',
             f'local all {users} reject', f'host all {users} all reject',
             f'local replication {users} reject', f'host replication {users} all reject']
    return rows


def candidate(original, databases):
    if not isinstance(original, bytes) or not original or len(original) > 262144 or b'\x00' in original:
        raise ValueError('BoundedOriginalHBARequired')
    if BEGIN.encode() in original or END.encode() in original:
        raise ValueError('QueueBoundaryAlreadyPresent_NoReplay')
    prefix = (BEGIN + '\n' + '\n'.join(rules(databases)) + '\n' + END + '\n').encode()
    return prefix + original


def verify_parsed(rows, databases, original_error_count=0):
    expected = rules(databases)
    if original_error_count or not isinstance(rows, list) or any(row.get('error') for row in rows):
        raise ValueError('HBAParserError_RestoreRequired')
    active = sorted(rows, key=lambda row: row['rule_number'])
    if len(active) < len(expected):
        raise ValueError('QueueRulesMissing_RestoreRequired')
    for row, line in zip(active, expected):
        parts = line.split()
        kind, database, users = parts[:3]
        expected_address = 'all' if kind == 'host' else None
        if (row.get('type') != kind or row.get('database') != [database.strip('"')]
                or row.get('user_name') != list(ROLES) or row.get('auth_method') != parts[-1]
                or row.get('address') != expected_address or row.get('options') not in (None, [])):
            raise ValueError('QueueFirstMatchOrderingMismatch_RestoreRequired')
    return {'status': 'PASS', 'managedRules': len(expected), 'beforeEveryOriginalRule': True,
            'localCovered': True, 'ipv4Covered': True, 'ipv6Covered': True,
            'futureDatabasesDenied': True, 'replicationDenied': True, 'authentication': 'scram-sha-256'}
