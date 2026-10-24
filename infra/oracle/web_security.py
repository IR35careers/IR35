"""Known-patched P5 source gate. No provider calls or dependency exceptions."""
import re


def security_versions(lock):
    packages=lock.get('packages',{});root=packages.get('',{})
    expected={'next':'16.4.3','react':'19.2.9','react-dom':'19.2.9','eslint-config-next':'16.4.3','sharp':'0.35.5'}
    for name,version in expected.items():
        item=packages.get('node_modules/'+name,{})
        if item.get('version')!=version or not re.fullmatch(r'sha512-[A-Za-z0-9+/=]+',item.get('integrity','')):
            raise RuntimeError('PatchedDependencyLockRequired')
        if name!='sharp':
            group='devDependencies' if name=='eslint-config-next' else 'dependencies'
            if root.get(group,{}).get(name)!=version:raise RuntimeError('ExactPatchedDependencyPinRequired')
    return expected


def deployable_build(build):
    if build.get('status')!='PASS' or build.get('architecture')!='linux/arm64' or build.get('nonroot')is not True:
        raise RuntimeError('P5VerifiedARMImageRequired')
    if not re.fullmatch(r'sha256:[0-9a-f]{64}',build.get('image','')) or not re.fullmatch(r'[0-9a-f]{40}',build.get('sourceSHA','')):
        raise RuntimeError('P5ImageIdentityRequired')
    if build.get('securityVersions')!={'next':'16.4.3','react':'19.2.9','react-dom':'19.2.9','eslint-config-next':'16.4.3','sharp':'0.35.5'}:
        raise RuntimeError('PatchedNativeBuildRequired_NoHistoricalImage')
