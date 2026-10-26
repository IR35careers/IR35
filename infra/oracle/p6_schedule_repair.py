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
    name='p6_schedule_repair_guest'
    code=(schema.REPO/'infra/oracle'/(name+'.py')).read_text()
    return p6_resume.bundle()+'module=types.ModuleType('+repr(name)+');sys.modules['+repr(name)+']=module\nexec('+repr(code)+',module.__dict__)\n'


def main():
    if sys.argv[1:]!=['--diagnose']:raise RuntimeError('ExplicitReadOnlyScheduleDiagnosisRequired')
    destination=p6_resume.DIRECTORY/'owner-resume-schedule-diagnosis.json'
    if destination.exists():raise RuntimeError('ScheduleDiagnosisRecorded_NoReplay')
    payload=data()
    script=bundle()+'result=sys.modules["p6_schedule_repair_guest"].diagnose('+repr(payload)+',runtime)\nprint(json.dumps(result))\n'
    result=schema.run_guest(script,timeout=400)
    with destination.open('x',encoding='utf-8') as output:json.dump(result,output,indent=2)
    print(json.dumps(result))
    if result['status']!='PASS':raise SystemExit(1)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'status':'STOP','code':str(error) if type(error)is RuntimeError else type(error).__name__,'rawErrorWithheld':True}))
        raise SystemExit(1)
