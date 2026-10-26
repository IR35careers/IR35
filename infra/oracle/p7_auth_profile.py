"""Typed non-secret source settings -> isolated GoTrue rehearsal configuration."""
import copy
import re
import export_auth_settings as exporter

SOURCE_SHA='b6f708f921a730b8e07e5c2e77052318207900d06b3d855d9b45fa28f2a959c9'
SUPPLEMENT_SHA='fc936b56f693bd432486ac0cac28c55b0ce473932f4476c1b0fe1c856306fb95'
DURATIONS={'smtp_max_frequency','mfa_phone_max_frequency','sessions_timebox','sessions_inactivity_timeout'}
SENSITIVE_CONTROLS=('security_captcha_enabled','saml_enabled','oauth_server_enabled','custom_oauth_enabled',
    'external_phone_enabled','external_anonymous_users_enabled','passkey_enabled','password_hibp_enabled')


class ProfileError(RuntimeError):pass


def validate(handoff):
    if type(handoff)is not dict or set(handoff)!={'format','source_sha256','supplement_sha256','settings'}:
        raise ProfileError('ExactP7HandoffRequired')
    if handoff['format']!='ir35-p7-source-v1' or handoff['source_sha256']!=SOURCE_SHA or handoff['supplement_sha256']!=SUPPLEMENT_SHA:
        raise ProfileError('G3SourceBindingMismatch')
    values=handoff['settings']
    if type(values)is not dict or set(values)!=set(exporter.ALLOWLIST):raise ProfileError('ExactNonSecretAllowlistRequired')
    projected=exporter.project(values,'<NO_PERSONAL_TOKEN_IN_HANDOFF>')['settings']
    if projected!=values:raise ProfileError('UnsafeOrInvalidSourceSetting')
    for name,value in values.items():
        if value is None:
            provider=name.removeprefix('external_').removesuffix('_client_id').removesuffix('_additional_client_ids')
            if not (name.startswith('external_') and 'client_id'in name and values.get('external_'+provider+'_enabled')is False):
                raise ProfileError('UnresolvedSourceField_'+name)
    for name in SENSITIVE_CONTROLS:
        if values[name]is True:raise ProfileError('OwnerOnlyExternalControl_'+name)
    if any(values['hook_'+name+'_enabled']is True for name in exporter.HOOKS):raise ProfileError('ExternalAuthHookNotRehearsableWithoutOwner')
    if values['external_email_enabled']is not True or values['mailer_autoconfirm']is not False:
        raise ProfileError('ConfirmedEmailSafetyContractRequired')
    if any(values[name]!='' for name in exporter.PUBLIC_SUPPLEMENT_FIELDS):raise ProfileError('ExactOwnerNoneDecisionsRequired')
    return values


def configure(auth,handoff,template_host):
    values=validate(handoff)
    if not re.fullmatch(r'ir35-p4-[a-z0-9-]+-templates',template_host):raise ProfileError('PrivateTemplateContainerNameRequired')
    result=copy.deepcopy(auth);templates={};subjects={};deferred=[];omitted=[]
    for name,value in values.items():
        if value is None:continue
        if name.startswith('mailer_templates_') and name.endswith('_content'):
            kind=name[len('mailer_templates_'):-len('_content')]
            if kind not in exporter.TEMPLATES or type(value)is not str:raise ProfileError('ExplicitTemplateNameRequired')
            templates[kind]=value
            result['GOTRUE_MAILER_TEMPLATES_'+kind.upper()]='http://'+template_host+':8080/'+kind
            continue
        if name.startswith('mailer_subjects_'):
            if type(value)is not str or any(c in value for c in '\r\n\0'):raise ProfileError('SubjectHeaderInjectionRefused')
            subjects['GOTRUE_'+name.upper()]=value
            continue
        if name in ('site_url','uri_allow_list','smtp_host','smtp_port','external_google_additional_client_ids','external_apple_additional_client_ids'):
            continue
        key='GOTRUE_'+name.upper()
        if name=='refresh_token_rotation_enabled':key='GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED'
        if name in DURATIONS:
            if type(value)is not int or value<0:raise ProfileError('NonnegativeDurationRequired')
            if name.startswith('sessions_') and value==0:
                result.pop(key,None);omitted.append(name);continue
            value=str(value)+'s'
        if name in ('external_'+provider+'_enabled' for provider in exporter.PROVIDERS) and value is True:
            deferred.append(name);value=False  # Never import an OAuth secret or call a real provider.
        if name=='external_google_skip_nonce_check':value=False
        if type(value)is bool:value='true' if value else 'false'
        elif type(value)is int:value=str(value)
        if type(value)is not str or any(c in value for c in "'\r\n\0"):raise ProfileError('ExistingStrictEnvironmentEncodingRequired_'+name)
        result[key]=value
    result.update(GOTRUE_SITE_URL='https://staging.ir35careers.com',API_EXTERNAL_URL='https://api-staging.ir35careers.com',
        GOTRUE_URI_ALLOW_LIST='https://staging.ir35careers.com/auth/callback',GOTRUE_SMTP_HOST='smtp',GOTRUE_SMTP_PORT='1025',
        GOTRUE_SMTP_USER='',GOTRUE_SMTP_PASS='')
    for key in subjects:result.pop(key,None)
    return result,templates,subjects,{'sourceFields':len(values),'templateCount':len(templates),'subjectCount':len(subjects),
        'deferredProviderFieldNames':deferred,'sourceZeroOptionalSessionDurationsOmitted':omitted,
        'smtpSink':True,'stagingURLsOnly':True,'valuesPrinted':False,'providerLoginProven':False}


def subject_env(subjects):
    allowed={'GOTRUE_MAILER_SUBJECTS_'+kind.upper() for kind in exporter.TEMPLATES}
    if set(subjects)-allowed or any(type(v)is not str or any(c in v for c in '\r\n\0') for v in subjects.values()):
        raise ProfileError('PublicSubjectsOnlyNoNewlines')
    return ''.join(key+'='+value+'\n' for key,value in sorted(subjects.items()))
