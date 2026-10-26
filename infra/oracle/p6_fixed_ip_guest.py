"""Single owner-approved fixed endpoint. No Docker network/OCI creation."""
import ipaddress
import json
from pathlib import Path

from immutable_artifacts import digest
from p6_mock_guest import ROOT,prepared,validate_config
from p6_restart_diagnosis_guest import history,queue_ledger,external_isolation
from web_edge_guest import private_env

NETWORK='ir35-staging_backend'
ADDRESS='172.18.0.240'
NAME='ir35-p6-mock-worker-v7-fixedip'
UNIT='ir35-p6-health-proxy-fixedip-owner1'
COMPOSE=ROOT/'p6-mock-compose-v7-fixedip.yml'


def network_plan(network,address=ADDRESS):
    if network.get('Name')!=NETWORK or network.get('Driver')!='bridge' or network.get('Internal')is not True:
        raise RuntimeError('ExistingPrivateBridgeRequired_NoNetworkChange')
    configs=network.get('IPAM',{}).get('Config',[])
    subnets=[ipaddress.ip_network(row['Subnet']) for row in configs if row.get('Subnet') and ':' not in row['Subnet']]
    ip=ipaddress.ip_address(address)
    if ip.version!=4 or len(subnets)!=1 or ip not in subnets[0] or not ip.is_private or ip in (subnets[0].network_address,subnets[0].broadcast_address):
        raise RuntimeError('FixedIPv4InsideExistingIPAMRequired')
    used={str(ipaddress.ip_interface(row['IPv4Address']).ip) for row in network.get('Containers',{}).values() if row.get('IPv4Address')}
    reserved={row['Gateway'] for row in configs if row.get('Gateway')}|{str(v) for row in configs for v in row.get('AuxiliaryAddresses',{}).values()}
    if address in used|reserved:raise RuntimeError('FixedIPv4AlreadyAllocated_NoDisconnectOrRetry')
    return {'status':'PASS','network':NETWORK,'networkID':network['Id'],'internal':True,'driver':'bridge',
        'subnet':str(subnets[0]),'ipv4_address':address,'addressUnallocated':True,'existingEndpoints':len(used),
        'newNetworks':0,'networkRulesChanged':False}


def preflight(data,runtime):
    history(data);prepared(data)
    network=json.loads(runtime['run'](['docker','inspect','--type','network',NETWORK]))[0]
    plan=network_plan(network)
    ledger=queue_ledger(data,runtime);external=external_isolation(data,runtime)
    if ledger['status']!='PASS' or external['status']!='PASS':raise RuntimeError('FixedIPPrerequisiteDataOrSecurityMismatch')
    names=runtime['run'](['docker','ps','-a','--format','{{.Names}}']).splitlines()
    if NAME in names or COMPOSE.exists() or any((Path('/etc/systemd/system')/(UNIT+suffix)).exists() for suffix in ('.service','.socket')):
        raise RuntimeError('FixedIPRepairAlreadyExists_NoReplay')
    images=json.loads(runtime['run'](['docker','image','inspect',data['finalBuild']['image'],data['rollbackBuild']['image']]))
    if [row['Id'] for row in images]!=[data['finalBuild']['image'],data['rollbackBuild']['image']] or any(row['Architecture']!='arm64' for row in images):
        raise RuntimeError('BothRetainedPinnedARMImagesRequired')
    values=private_env(ROOT/'.env.p6-mock-worker');validate_config(values)
    containers=json.loads(runtime['run'](['docker','inspect',*runtime['run'](['docker','ps','-q']).splitlines()]))
    services=[{'name':row['Name'].lstrip('/'),'image':row['Image'],'state':row['State']['Status'],
        'health':row['State'].get('Health',{}).get('Status'),'restartPolicy':row['HostConfig']['RestartPolicy']['Name'],
        'memoryLimitBytes':row['HostConfig']['Memory']} for row in containers]
    memory={key:int(value.split()[0]) for line in Path('/proc/meminfo').read_text().splitlines() for key,value in [line.split(':',1)]
        if key in ('MemAvailable','MemTotal','SwapFree','SwapTotal')}
    return {'status':'PASS','readOnly':True,'vmWrites':0,'plan':plan,'ledger':ledger,'externalIsolation':external,'services':services,
        'memoryKiB':memory,'candidateImage':images[0]['Id'],'rollbackImage':images[1]['Id'],
        'secretsUnchanged':True,'privateWorkerEnvSHA256':digest((ROOT/'.env.p6-mock-worker').read_bytes())}
