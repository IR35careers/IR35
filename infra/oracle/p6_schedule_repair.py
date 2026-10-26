"""Final bounded resumed-lifecycle repair; diagnosis is strictly read-only."""
import json
import sys
import cloud_schema as schema
import p6_resume


def data():
    payload=p6_resume.context()
    payload['scheduleFailure']=json.loads((p6_resume.DIRECTORY/'owner-resume-lifecycle-pause-repair-one.json').read_text())
    return payload


def bundle():
    script=p6_resume.bundle()
    for name in ('p6_schedule_repair_guest','p6_schedule_drain_guest'):
        code=(schema.REPO/'infra/oracle'/(name+'.py')).read_text()
        script+='module=types.ModuleType('+repr(name)+');sys.modules['+repr(name)+']=module\nexec('+repr(code)+',module.__dict__)\n'
    return script


def main():
    if sys.argv[1:] not in (['--diagnose'],['--drain-existing']):raise RuntimeError('ExplicitReadOnlyScheduleDiagnosisRequired')
    draining=sys.argv[1:]==['--drain-existing']
    destination=p6_resume.DIRECTORY/('owner-resume-schedule-drain.json' if draining else 'owner-resume-schedule-diagnosis.json')
    if destination.exists():raise RuntimeError('ScheduleDiagnosisRecorded_NoReplay')
    payload=data()
    if draining:
        payload['pauseHandover']=json.loads((p6_resume.DIRECTORY/'owner-resume-handover-pause-repair-one.json').read_text())
        payload['scheduleDiagnosis']=json.loads((p6_resume.DIRECTORY/'owner-resume-schedule-diagnosis.json').read_text())
        if payload['scheduleDiagnosis'].get('status')!='PASS' or payload['scheduleDiagnosis'].get('vmWrites')!=0:
            raise RuntimeError('ReadOnlyScheduleDiagnosisRequired')
    module='p6_schedule_drain_guest' if draining else 'p6_schedule_repair_guest'
    script=bundle()+'result=sys.modules['+repr(module)+'].'+('drain' if draining else 'diagnose')+'('+repr(payload)+',runtime)\nprint(json.dumps(result))\n'
    result=schema.run_guest(script,timeout=400)
    with destination.open('x',encoding='utf-8') as output:json.dump(result,output,indent=2)
    print(json.dumps(result))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__,'rawErrorWithheld':True}))
        raise SystemExit(1)
