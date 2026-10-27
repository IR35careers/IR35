"""Pure source/resource gates for NEW P8 images, never old build-slot replay."""
import re

REQUIRED_CHECKS = {
    'CodeQL', 'JavaScript and TypeScript', 'Native arm64 image and isolated mock ATS',
    'Oracle local key custody tests', 'Private Caddy SDK ordering regression',
    'Worker Docker build and Postgres standby health', 'Code quality and production build',
    'Dependency and repository security',
    *(f'Responsive browser and accessibility ({device}-chrome)' for device in ('desktop', 'mobile', 'tablet')),
}


def hosted_checks(value, sha):
    if not re.fullmatch('[a-f0-9]{40}', sha or '') or type(value) is not dict or type(value.get('check_runs')) is not list:
        raise RuntimeError('ExactHostedSourceChecksRequired')
    rows = value['check_runs']
    names = [row.get('name') for row in rows if type(row) is dict]
    if (len(names) != len(rows) or any(type(name) is not str or not 1 <= len(name) <= 200 for name in names)
            or len(set(names)) != len(names) or not REQUIRED_CHECKS.issubset(names)):
        raise RuntimeError('CompleteUniqueHostedChecksRequired_NoNativeBuild')
    result = []
    for row in rows:
        if (row.get('head_sha') != sha or row.get('status') != 'completed' or row.get('conclusion') != 'success'
                or type(row.get('id')) is not int or row['id'] <= 0):
            raise RuntimeError('HostedChecksNotGreenForExactSource_NoNativeBuild')
        result.append({key: row[key] for key in ('name', 'id', 'status', 'conclusion')})
    return {'status': 'PASS', 'sourceSHA': sha, 'checks': sorted(result, key=lambda row: row['name'])}


def resources(machine, cpus, total_kib, available_kib, free_bytes):
    if (machine != 'aarch64' or type(cpus) is not int or cpus != 2
            or any(type(value) is not int or value <= 0 for value in (total_kib, available_kib, free_bytes))
            or not 11 * 1024 * 1024 <= total_kib <= 12 * 1024 * 1024 or available_kib > total_kib):
        raise RuntimeError('ExistingTwoCpuTwelveGiBArmVmRequired')
    if available_kib < 4 * 1024 * 1024 or free_bytes < 15 * 1024 ** 3:
        raise RuntimeError('NativeBuildResourceHeadroomRequired_NoCreate')
    return {'status': 'PASS', 'machine': machine, 'cpus': cpus, 'memoryTotalKiB': total_kib,
            'memoryAvailableKiB': available_kib, 'dataFreeBytes': free_bytes,
            'newOCIResources': 0, 'billingProofClaimed': False}
