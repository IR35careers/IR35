"""Config-only SDK ordering and non-sensitive route diagnostics."""
import re


def sdk_block(text):
    start=text.index('        handle @sdk {\n')
    end=text.index('        handle {\n',start)
    return text[start:end]


def literal_sdk(block):
    lines=block.rstrip('\n').splitlines()
    if lines[0]!='        handle @sdk {' or lines[-1]!='        }' or any(line.strip()=='route {' for line in lines):
        raise RuntimeError('OriginalSDKHandleRequired')
    return lines[0]+'\n            route {\n'+'\n'.join('    '+line for line in lines[1:-1])+'\n            }\n'+lines[-1]+'\n'


def instrument_sdk(block):
    lines=[]
    for line in block.splitlines():
        indent=line[:len(line)-len(line.lstrip())]
        if line.strip().startswith('respond @missing_gate '):
            lines.append(indent+'header @missing_gate >X-IR35-Matched-Route "sdk-guard"')
        if line.strip()=='respond "Not found" 404':
            lines.append(indent+'header X-IR35-Matched-Route "sdk-fallback"')
        if line.strip().startswith('reverse_proxy @api '):
            lines.append(indent+'header @api X-IR35-Matched-Route "sdk-proxy"')
        lines.append(line)
    return '\n'.join(lines)+'\n'


def instrument_edge(text):
    block=sdk_block(text)
    text=text.replace(block,instrument_sdk(block),1)
    text=text.replace('header >Cache-Control "no-store"',
        'header >Cache-Control "no-store"\n    header X-Caddy-Request-ID {http.request.uuid}\n    header >X-Caddy-Request-ID {http.request.uuid}',1)
    text=text.replace('                basic_auth {','                header X-IR35-Matched-Route "basic-auth-rejection"\n                basic_auth {',1)
    text=text.replace('                reverse_proxy ir35-p5-web:3000 {','                header X-IR35-Matched-Route "page-proxy"\n                reverse_proxy ir35-p5-web:3000 {',1)
    head,tail=text.split('\napi-staging.ir35careers.com {',1)
    tail=tail.replace('        basic_auth {','        header X-IR35-Matched-Route "api-basic-rejection"\n        basic_auth {',1)
    tail=tail.replace('        reverse_proxy @api ir35-p5-kong:8000 {','        header @api X-IR35-Matched-Route "api-proxy"\n        reverse_proxy @api ir35-p5-kong:8000 {',1)
    tail=tail.replace('        respond "Not found" 404','        header X-IR35-Matched-Route "api-fallback"\n        respond "Not found" 404',1)
    text=head+'\napi-staging.ir35careers.com {'+tail
    # These labels describe the Caddy branch, not a user/tenant/path or token.
    return text


def redact_adapted(value,secrets):
    if isinstance(value,dict):return {key:redact_adapted(item,secrets) for key,item in value.items()}
    if isinstance(value,list):return [redact_adapted(item,secrets) for item in value]
    if isinstance(value,str):
        for secret,label in sorted(secrets.items(),key=lambda item:len(item[0]),reverse=True):
            if secret:value=value.replace(secret,label)
    return value
