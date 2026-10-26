"""Owner-run, stdlib-only, one fixed read-only request; no token persistence."""
import base64
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import ssl
import stat
import subprocess
import sys
import tempfile
import urllib.request
import warnings

ENDPOINT='https://api.supabase.com/v1/projects/kxcbgflleqnjzjbkevwd/config/auth'
DESTINATION=Path(r'C:\Users\anves\.oci\ir35-p0-readonly\oracle-auth-settings.json')
MAX_BYTES=4*1024*1024

# Explicit names, never wildcard selection from the server response. JWT fields
# and credential-bearing hook URLs are deliberately absent, including JWT TTL.
TEXT_FIELDS=tuple('''site_url uri_allow_list smtp_host smtp_port smtp_admin_email smtp_sender_name
password_required_characters security_captcha_provider'''.split())
BOOL_FIELDS=tuple('''disable_signup external_email_enabled external_anonymous_users_enabled external_phone_enabled
mailer_autoconfirm mailer_allow_unverified_email_sign_ins mailer_secure_email_change_enabled
refresh_token_rotation_enabled sessions_single_per_user password_hibp_enabled
security_captcha_enabled security_manual_linking_enabled security_sb_forwarded_for_enabled
security_update_password_require_current_password security_update_password_require_reauthentication
mfa_totp_enroll_enabled mfa_totp_verify_enabled mfa_phone_enroll_enabled mfa_phone_verify_enabled
mfa_web_authn_enroll_enabled mfa_web_authn_verify_enabled passkey_enabled
saml_enabled saml_allow_encrypted_assertions oauth_server_enabled oauth_server_allow_dynamic_registration
custom_oauth_enabled external_web3_solana_enabled external_web3_ethereum_enabled'''.split())
INT_FIELDS=tuple('''mailer_otp_exp mailer_otp_length smtp_max_frequency password_min_length
rate_limit_anonymous_users rate_limit_email_sent rate_limit_sms_sent rate_limit_token_refresh
rate_limit_verify rate_limit_otp rate_limit_web3 security_refresh_token_reuse_interval
sessions_timebox sessions_inactivity_timeout mfa_max_enrolled_factors mfa_phone_otp_length
mfa_phone_max_frequency custom_oauth_max_providers'''.split())
PROVIDERS=('apple','azure','bitbucket','discord','facebook','figma','github','gitlab','google','kakao',
    'keycloak','linkedin_oidc','slack_oidc','notion','slack','spotify','twitch','twitter','x','workos','zoom')
TEMPLATES=('confirmation','email_change','invite','magic_link','recovery','reauthentication',
    'password_changed_notification','email_changed_notification','phone_changed_notification',
    'mfa_factor_enrolled_notification','mfa_factor_unenrolled_notification','identity_linked_notification',
    'identity_unlinked_notification')
NOTIFICATIONS=('password_changed','email_changed','phone_changed','mfa_factor_enrolled',
    'mfa_factor_unenrolled','identity_linked','identity_unlinked')
HOOKS=('custom_access_token','mfa_verification_attempt','password_verification_attempt','send_sms',
    'send_email','before_user_created','after_user_created')
ALLOWLIST={**{name:(str,) for name in TEXT_FIELDS},**{name:(bool,) for name in BOOL_FIELDS},
    **{name:(int,) for name in INT_FIELDS},
    **{'external_'+name+'_enabled':(bool,) for name in PROVIDERS},
    **{'external_'+name+'_client_id':(str,) for name in PROVIDERS},
    **{'mailer_subjects_'+name:(str,) for name in TEMPLATES},
    **{'mailer_templates_'+name+'_content':(str,) for name in TEMPLATES},
    **{'mailer_notifications_'+name+'_enabled':(bool,) for name in NOTIFICATIONS},
    **{'hook_'+name+'_enabled':(bool,) for name in HOOKS},
    'external_google_additional_client_ids':(str,),'external_google_skip_nonce_check':(bool,),
    'external_apple_additional_client_ids':(str,),'smtp_port':(str,int)}


class ExportRefused(RuntimeError):pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise ExportRefused('RedirectRefused')


def unique_object(pairs):
    result={}
    for name,value in pairs:
        if name in result:raise ExportRefused('DuplicateResponseField')
        result[name]=value
    return result


def project(payload,token):
    if not isinstance(payload,dict):raise ExportRefused('ObjectResponseRequired')
    settings={}
    for name,types in sorted(ALLOWLIST.items()):
        value=payload.get(name)
        if type(value) not in types:value=None
        if isinstance(value,str) and (len(value)>524288 or token in value
                or re.search(r'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+',value)
                or re.search(r'\b(?:sbp_|sb_secret_)[A-Za-z0-9_-]+',value)
                or re.search(r'https?://[^/\s\"<>]*@',value)):
            value=None  # Never rewrite source content; require manual review.
        settings[name]=value
    missing=[name for name,value in settings.items() if value is None]
    return {'settings':settings,'missing_fields':missing}


def fetch(token):
    if not isinstance(token,str) or not re.fullmatch(r'[A-Za-z0-9._~-]{1,4096}',token):raise ExportRefused('HiddenTokenRequired')
    request=urllib.request.Request(ENDPOINT,method='GET',headers={'Authorization':'Bearer '+token,
        'Accept':'application/json','Accept-Encoding':'identity'})
    try:
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),
            urllib.request.HTTPSHandler(context=ssl.create_default_context()))
        with opener.open(request,timeout=25) as response:
            if response.status!=200 or response.geturl()!=ENDPOINT:raise ExportRefused('FixedResponseRequired')
            raw=response.read(MAX_BYTES+1)
        if len(raw)>MAX_BYTES:raise ExportRefused('ResponseTooLarge')
        payload=json.loads(raw,object_pairs_hook=unique_object)
        return project(payload,token)
    finally:
        request.remove_header('Authorization');token=None


def windows_acl(path,*,apply=False):
    """Public path/ACL code only in the child argv; never the Supabase token."""
    literal=str(path).replace("'","''")
    script="$ErrorActionPreference='Stop';$p='"+literal+"';$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;"
    if apply:
        script+="$s=[System.Security.AccessControl.FileSecurity]::new();$s.SetOwner($sid);$s.SetAccessRuleProtection($true,$false);$s.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow'));Set-Acl -LiteralPath $p -AclObject $s;"
    script+="$a=Get-Acl -LiteralPath $p;$r=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]));$ok=$a.AreAccessRulesProtected -and $r.Count -eq 1 -and $r[0].IdentityReference -eq $sid -and $r[0].AccessControlType -eq 'Allow' -and $a.GetOwner([System.Security.Principal.SecurityIdentifier]) -eq $sid;if(-not $ok){exit 1};[Console]::Write('ok')"
    system_root=os.environ.get('SystemRoot',r'C:\Windows')
    executable=Path(system_root)/'System32/WindowsPowerShell/v1.0/powershell.exe'
    reply=subprocess.run([str(executable),'-NoProfile','-NonInteractive','-EncodedCommand',
        base64.b64encode(script.encode('utf-16le')).decode()],capture_output=True,timeout=20,
        creationflags=subprocess.CREATE_NO_WINDOW,env={'SystemRoot':system_root,'WINDIR':system_root})
    if reply.returncode or reply.stdout.strip()!=b'ok':raise ExportRefused('OwnerOnlyACLRequired')


def custody(path,*,apply=False):
    if path.is_symlink():raise ExportRefused('RegularPrivateFileRequired')
    info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1:raise ExportRefused('RegularPrivateFileRequired')
    if os.name=='nt':windows_acl(path,apply=apply)
    else:
        if apply:path.chmod(0o600)
        info=path.lstat()
        if info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600:raise ExportRefused('OwnerOnlyModeRequired')


def blank(value):
    if isinstance(value,dict):return all((key=='format' and item=='ir35-auth-settings-handoff-v1') or blank(item) for key,item in value.items())
    if isinstance(value,list):return not value
    return value is None


def target_snapshot(path):
    for candidate in (path,*path.parents):
        if candidate.is_symlink() or getattr(candidate,'is_junction',lambda:False)():raise ExportRefused('ReparseTargetRefused')
    if not path.parent.is_dir():raise ExportRefused('ExistingPrivateDirectoryRequired')
    if not path.exists():return None
    custody(path)
    body=path.read_bytes()
    if len(body)>MAX_BYTES or not blank(json.loads(body)):raise ExportRefused('ExistingHandoffPreserved')
    return hashlib.sha256(body).hexdigest()


def write_export(path,export,snapshot):
    body=(json.dumps(export,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode()
    if len(body)>MAX_BYTES:raise ExportRefused('ExportTooLarge')
    descriptor,name=tempfile.mkstemp(prefix='.ir35-auth-export-',suffix='.tmp',dir=path.parent)
    temporary=Path(name)
    try:
        custody(temporary,apply=True)  # Empty until ACL is verified.
        with os.fdopen(descriptor,'wb') as output:
            descriptor=None;output.write(body);output.flush();os.fsync(output.fileno())
        custody(temporary)
        if target_snapshot(path)!=snapshot:raise ExportRefused('HandoffChangedDuringRead')
        os.replace(temporary,path);custody(path)
        expected=hashlib.sha256(body).hexdigest()
        if hashlib.sha256(path.read_bytes()).hexdigest()!=expected:raise ExportRefused('ExportReadbackMismatch')
        return expected
    finally:
        if descriptor is not None:os.close(descriptor)
        if temporary.exists():temporary.unlink()  # Only this newly created temporary.


def native_windows():return os.name=='nt'


def main():
    summary={'field_count':0,'null_fields':sorted(ALLOWLIST),'file_sha256':None};token=None
    try:
        if len(sys.argv)!=1 or not native_windows():raise ExportRefused('NativeWindowsNoArgumentsRequired')
        snapshot=target_snapshot(DESTINATION)
        with warnings.catch_warnings():
            warnings.simplefilter('error',getpass.GetPassWarning)
            token=getpass.getpass('Supabase personal access token (hidden): ')
        export=fetch(token);token=None
        digest=write_export(DESTINATION,export,snapshot)
        summary={'field_count':len(ALLOWLIST),'null_fields':export['missing_fields'],'file_sha256':digest}
        print(json.dumps(summary));return 0
    except (Exception,KeyboardInterrupt):
        print(json.dumps(summary));return 1  # Never output traceback/body/headers/token.
    finally:token=None


if __name__=='__main__':raise SystemExit(main())
