"""P6 has its own authority/context; never reopens a P5 mutation controller."""
import json
import subprocess
import cloud_schema as schema
import p4_recovery
import web_fixture
from web_build import git_command
from web_security import deployable_build


def require_sdk(edge):
    cases=edge.get('activation',{}).get('cases',[])
    expected={'sdk-missing':401,'sdk-suffix':401,'sdk-valid':200}
    rows=[row for row in cases if row.get('case') in expected]
    if (edge.get('status')!='PASS' or edge.get('containment',{}).get('status')!='PASS'
        or len(rows)!=3 or len({row['case'] for row in rows})!=3
        or not all(row.get('passed')is True and row.get('expectedStatus')==expected[row['case']]
                   and row.get('actualStatus')==expected[row['case']] for row in rows)):
        raise RuntimeError('ActualP5SDK401401200AndContainmentRequired')


def context():
    git=git_command(schema.REPO)
    if subprocess.check_output(git+['branch','--show-current'],text=True).strip()!='codex/oracle-migration-p6':raise RuntimeError('P6BranchRequired')
    if subprocess.check_output(git+['status','--porcelain'],text=True).strip():raise RuntimeError('CommittedCleanP6SourceRequired')
    signoff=p4_recovery.reports().get('revised_signoff',{})
    if signoff.get('status')!='PASS' or signoff.get('phaseComplete')is not True:raise RuntimeError('RevisedP4SignoffRequired')
    evidence=schema.REPO/'docs/evidence'
    edge=json.loads((evidence/'p5-sdk-owner1/edge-summary.json').read_text())
    require_sdk(edge)
    audit=json.loads((evidence/'p5-runtime-audit.json').read_text())
    if edge.get('status')!='PASS' or edge.get('activation',{}).get('activationAttempts')!=1 or audit.get('status')!='PASS' or audit.get('containment',{}).get('status')!='PASS':raise RuntimeError('P5SDKAndRuntimePassRequired')
    paths=sorted((evidence/'p5').glob('build-*.json'));build=json.loads(paths[-1].read_text());deployable_build(build)
    # Historical running P5 image stays pinned; P6 source changes require their
    # OWN future image proof, not pretending that P5 was rebuilt/replaced.
    original=json.loads(subprocess.check_output(git+['show','5227cf0:docs/evidence/p5/build-3.json'],text=True))
    if build!=original:raise RuntimeError('P5BuildHistoryChanged')
    pins=json.loads((schema.REPO/'infra/oracle/staging-images.json').read_text())['images']
    pins['storage']=json.loads((schema.REPO/'infra/oracle/storage-compatible-image.json').read_text())['image']
    anchors={}
    for name in ('prepare','services','edge-prepare','edge-activate','edge-repair-1','edge-repair-2','containment-audit'):
        report=json.loads((evidence/('p5/'+name+'.json')).read_text())
        for item in (report['preparation'],report['activation']) if name.startswith('edge-repair-') else (report,):anchors[item['stage']]=item['manifestSHA256']
    return {'p4':p4_recovery.payload()|{'pins':pins},'build':build,'buildAnchors':{json.loads(path.read_text())['stage']:json.loads(path.read_text())['manifestSHA256'] for path in paths},
            'p5Anchors':anchors,'prepareAnchor':anchors['01-prepare'],'sdkAnchors':{edge[name]['stage']:edge[name]['manifestSHA256'] for name in ('preparation','activation','containment')},
            'runtimeAudit':{'root':audit['journal'],'stage':audit['stage'],'manifestSHA256':audit['manifestSHA256']}}


def bundle():
    script=web_fixture.runtime_bundle()
    for name in ('sdk_gate_observation','sdk_owner1_guest','p6_inventory_guest'):
        code=(schema.REPO/'infra/oracle'/(name+'.py')).read_text()
        script+='module=types.ModuleType('+repr(name)+');sys.modules['+repr(name)+']=module\nexec('+repr(code)+',module.__dict__)\n'
    return script
