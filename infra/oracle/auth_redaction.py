"""Fail-closed public projection of Auth responses and request-correlated logs."""
import json
import re

# Unknown text stays private in RAM. No generic vendor exception/string output.
MESSAGES = frozenset((
    'Invalid login credentials', 'Email not confirmed', 'User is banned',
    'Email logins are disabled', 'Invalid API key', 'No API key found in request',
    'invalid_grant', 'invalid_credentials', 'invalid_request',
    'Request completed', 'request completed', 'Database error querying schema',
    'Email rate limit exceeded', 'Email address not authorized',
    'missing email or phone', 'unsupported_grant_type',
))
ERROR_CODES = frozenset(('invalid_credentials','email_not_confirmed','user_banned',
    'email_provider_disabled','validation_failed','unexpected_failure','request_timeout',
    'over_request_rate_limit','over_email_send_rate_limit','email_address_not_authorized',
    'captcha_failed','bad_json','no_authorization','bad_jwt','otp_expired','email_exists',
    'session_not_found','refresh_token_not_found','refresh_token_already_used'))


def safe_text(value):
    return value if isinstance(value,str) and value in MESSAGES else ('[withheld]' if value is not None else None)


def request_id(value):
    return value if isinstance(value,str) and re.fullmatch(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',value) else None


def response_diagnostic(status,body,headers,expected):
    try:row=json.loads(body) if len(body)<=65536 else {}
    except (ValueError,TypeError):row={}
    if not isinstance(row,dict):row={}
    # Error codes are enums, but still reject arbitrary strings/secret material.
    code=row.get('error_code')
    if not isinstance(code,str) or code not in ERROR_CODES:code=None
    ids=[request_id(row.get(k)) for k in ('request_id','requestId','error_id')]
    ids.extend(request_id(value) for key,value in headers.items() if key.lower()=='x-request-id')
    return {'status':status,'error_code':code,'error':safe_text(row.get('error')),
            'msg':safe_text(row.get('msg',row.get('error_description'))),
            'requestId':next((x for x in ids if x),None),
            'requestIdFromBody':request_id(row.get('request_id',row.get('requestId',row.get('error_id')))),
            'clientRequestId':expected,'redaction':'strict known-message projection; all other fields withheld'}


def correlated_logs(raw,expected):
    result=[]
    for line in raw.splitlines()[:1000]:
        try:row=json.loads(line)
        except (ValueError,TypeError):continue
        if not isinstance(row,dict) or row.get('request_id')!=expected:continue
        out={'requestId':expected,'msg':safe_text(row.get('msg')),'error':safe_text(row.get('error'))}
        for key in ('status','level','method','path','error_code'):
            value=row.get(key)
            if key=='status' and type(value) is int and 100<=value<=599:out[key]=value
            elif key=='level' and value in ('info','error','warn','warning'):out[key]=value
            elif key=='method' and value in ('POST','GET'):out[key]=value
            elif key=='path' and value in ('/token','/user','/otp','/verify','/logout'):out[key]=value
            elif key=='error_code' and isinstance(value,str) and value in ERROR_CODES:out[key]=value
        result.append(out)
    return result


def redact_known_secrets(value,secrets):
    """Even a credential equal to a known public error string must not escape."""
    if isinstance(value,str):
        for secret in secrets:
            if isinstance(secret,str) and secret:value=value.replace(secret,'[redacted]')
        return value
    if isinstance(value,list):return [redact_known_secrets(item,secrets) for item in value]
    if isinstance(value,dict):return {key:redact_known_secrets(item,secrets) for key,item in value.items()}
    return value
