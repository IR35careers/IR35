"""Read-only Auth configuration/account comparison. No login and no hash output."""
import json
import os
import urllib.request
import cloud_schema as schema
import owner_parity
import storage_compat

SQL = """SELECT jsonb_build_object(
 'count', count(*),
 'confirmed',coalesce(bool_and(email_confirmed_at IS NOT NULL),false),
 'bannedNull',coalesce(bool_and(banned_until IS NULL),false),
 'deletedNull',coalesce(bool_and(deleted_at IS NULL),false),
 'ssoFalse',coalesce(bool_and(is_sso_user IS FALSE),false),
 'aud',min(aud),'role',min(role),
 'bcrypt',coalesce(bool_and(encrypted_password LIKE '$2%'),false),
 'passwordMD5',min(md5(encrypted_password)),
 'emailIdentities',(SELECT count(*) FROM auth.identities i JOIN auth.users u ON u.id=i.user_id
   WHERE lower(u.email)='anvesh.mannuru+ir35test@gmail.com' AND i.provider='email'))
 FROM auth.users WHERE lower(email)='anvesh.mannuru+ir35test@gmail.com';"""

GUEST = r'''
sql=ACCOUNT_SQL
result=subprocess.run(base+['psql','-XqAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',TARGET,'-f','-'],
 input='BEGIN READ ONLY;'+sql+'ROLLBACK;',capture_output=True,text=True,timeout=30)
if result.returncode:raise RuntimeError('Read-only Auth fields query failed; raw output withheld')
target=json.loads(result.stdout);source=SOURCE
fields={k:target.get(k)==source.get(k) for k in source}
safe={k:v for k,v in target.items() if k!='passwordMD5'}
safe['passwordMD5EqualsCloud']=fields.pop('passwordMD5',False)
path=ROOT/'.env.p4-auth-login';s=path.lstat()
if not stat.S_ISREG(s.st_mode) or s.st_uid!=1002 or stat.S_IMODE(s.st_mode)!=0o600:raise RuntimeError('Private Auth env custody required')
component={}
for line in path.read_text().splitlines():
 m=re.fullmatch(r"([A-Z][A-Z0-9_]*)='([^'\r\n]*)'",line)
 if not m:raise RuntimeError('Private Auth env format invalid')
 component[m[1]]=m[2]
values=read_env();db=urlsplit(component['GOTRUE_DB_DATABASE_URL'])
def valid_key(key,role):
 try:
  parts=key.split('.');claims=json.loads(base64.urlsafe_b64decode(parts[1]+'='*((4-len(parts[1])%4)%4)))
  signature=base64.urlsafe_b64encode(hmac.new(values['JWT_SECRET'].encode(),'.'.join(parts[:2]).encode(),hashlib.sha256).digest()).decode().rstrip('=')
  return len(parts)==3 and hmac.compare_digest(signature,parts[2]) and claims.get('role')==role
 except Exception:return False
config={'emailEnabled':component.get('GOTRUE_EXTERNAL_EMAIL_ENABLED')=='true',
 'mailerAutoconfirm':component.get('GOTRUE_MAILER_AUTOCONFIRM')=='true',
 'siteURLStaging':component.get('GOTRUE_SITE_URL')=='https://staging.ir35careers.com',
 'externalURLStaging':component.get('API_EXTERNAL_URL')=='https://api-staging.ir35careers.com',
 'jwtAudienceMatchesAccount':component.get('GOTRUE_JWT_AUD')==target.get('aud'),
 'freshStagingJWTSecretConsistent':hmac.compare_digest(component.get('GOTRUE_JWT_SECRET',''),values['JWT_SECRET']),
 'anonKeySignatureValid':valid_key(values['ANON_KEY'],'anon'),
 'serviceKeySignatureValid':valid_key(values['SERVICE_ROLE_KEY'],'service_role'),
 'smtpSink':component.get('GOTRUE_SMTP_HOST')=='smtp' and component.get('GOTRUE_SMTP_PORT')=='1025',
 'isolatedDatabase':db.hostname=='db' and db.port==5432 and db.path=='/'+TARGET}
record=json.loads((ROOT/'config/p4-auth-login.json').read_text())
info=json.loads(run(['docker','inspect',record['containerId']]))[0]
config.update(authStopped=info['State']['Status']=='exited',noPublicPorts=not bool(info['HostConfig'].get('PortBindings')),
 originalLogDriverNone=info['HostConfig']['LogConfig']['Type']=='none')
required={'count':1,'confirmed':True,'bannedNull':True,'deletedNull':True,'ssoFalse':True,
 'aud':'authenticated','role':'authenticated','bcrypt':True,'emailIdentities':1}
account_ok=all(target.get(k)==v for k,v in required.items()) and all(fields.values()) and safe['passwordMD5EqualsCloud']
settings=SETTINGS
config_ok=all(value is True for key,value in config.items() if key!='mailerAutoconfirm') and config['mailerAutoconfirm'] is False
config_ok=config_ok and settings['emailEnabled'] is True and settings['mailerAutoconfirm'] is False
print(json.dumps({'status':'PASS' if account_ok and config_ok else 'FAIL',
 'account':safe,'fieldParity':fields,'config':config,'sourceSettings':SETTINGS,
 'sourceWrites':0,'stagingWrites':0,'passwordRequested':False,'previousErrorRecoverable':False}))
'''


def capture():
    with schema.Snapshot(schema.source_environment()) as snapshot:
        snapshot.send(SQL)
        source=json.loads(snapshot.line())
    # The public settings endpoint is a GET only. The anon key is RAM-only.
    key=os.environ.get('IR35_SOURCE_ANON_KEY','')
    if not key:raise RuntimeError('Read-only cloud Auth settings key required')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):raise RuntimeError('Cloud Auth redirect refused')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    request=urllib.request.Request('https://kxcbgflleqnjzjbkevwd.supabase.co/auth/v1/settings',headers={'apikey':key})
    with opener.open(request,timeout=20) as response:settings=json.loads(response.read(65536))
    public={'emailEnabled':settings.get('external',{}).get('email'),
            'mailerAutoconfirm':settings.get('mailer_autoconfirm'),
            'disableSignup':settings.get('disable_signup'),
            'siteURLAndExternalURL':'source production URLs intentionally replaced by approved staging hosts',
            'jwtSecret':'fresh staging-only; cloud secret never fetched'}
    code=GUEST.replace('ACCOUNT_SQL',repr(SQL)).replace('TARGET',repr(storage_compat.NAME)).replace('SOURCE',repr(source)).replace('SETTINGS',repr(public))
    result=schema.run_guest(schema.guest_bundle(rehearsal=True)+owner_parity.BASE+'\nimport hmac\n'+code)
    path=schema.REPO/'docs/evidence/oracle-p4-auth-diagnosis.json'
    path.write_text(json.dumps(result,indent=2)+'\n')
    if result['status']!='PASS':raise RuntimeError('Named staging/cloud account data mismatch; STOP')
    print(json.dumps({'status':'PASS','operation':'p4-auth-diagnosis','report':str(path.relative_to(schema.REPO)),'sourceWrites':0,'objects':len(result['fieldParity'])}))
