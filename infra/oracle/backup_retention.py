"""Offline retention planner. Never uploads/deletes or accepts partial estimates."""
from datetime import datetime,timezone

OWNER_CAP=8_000_000_000
PARTS=frozenset(('database','globals','queue','storage','verification'))


def exact_bytes(value):
    if type(value)is not int or value<0:raise ValueError('ExactNonnegativeByteCountRequired')
    return value


def plan(generations,*,observed_total_bytes,new_encrypted_bytes,now):
    """Totals include versions and unfinished multipart uploads, not just finals.

    Object Storage auditing supplies observed_total_bytes. Upload overlap must
    fit BEFORE retention; do not delete a restore point to make room. The plan
    is advisory: runtime must re-read ETags/hashes and exact totals before an
    approved prune and may delete only whole verified owned generations.
    """
    if now.tzinfo!=timezone.utc:raise ValueError('UTCClockRequired')
    total=exact_bytes(observed_total_bytes);incoming=exact_bytes(new_encrypted_bytes)
    if total+incoming>OWNER_CAP:raise ValueError('BackupUploadOverlapExceedsEightGB_Stop')
    seen=set();valid=[]
    for generation in generations:
        identity=generation['id']
        if type(identity)is not str or len(identity)!=16 or identity in seen:raise ValueError('UniqueGenerationIdentityRequired')
        try:created=datetime.strptime(identity,'%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
        except ValueError:raise ValueError('UTCGenerationIdentityRequired') from None
        if created>now:raise ValueError('FutureBackupIdentityRefused')
        seen.add(identity)
        if generation.get('complete')is not True or generation.get('restoreVerified')is not True:
            raise ValueError('UnverifiedOrPartialGeneration_Stop_NoPrune')
        if set(generation['parts'])!=PARTS:raise ValueError('AllDatabaseGlobalsQueueStorageAndVerificationPartsRequired')
        for part in generation['parts'].values():
            if part.get('ageEncrypted')is not True or part.get('sha256Verified')is not True or part.get('standardTier')is not True:
                raise ValueError('VerifiedAgeEncryptedStandardObjectsRequired')
            exact_bytes(part['bytes'])
        valid.append((created,identity))
    if sum(part['bytes'] for generation in generations for part in generation['parts'].values())>total:
        raise ValueError('GenerationBytesExceedExactInventory_Stop')
    valid.sort(reverse=True);daily={};weekly={}
    for created,identity in valid:
        daily.setdefault(created.date(),identity)
        weekly.setdefault(created.isocalendar()[:2],identity)
    keep=set(list(daily.values())[:7])|set(list(weekly.values())[:4])
    return {'dryRun':True,'ownerCapBytes':OWNER_CAP,'beforeBytes':total,'uploadOverlapBytes':total+incoming,
        'dailyAvailable':min(7,len(daily)),'weeklyAvailable':min(4,len(weekly)),
        'keep':sorted(keep),'eligibleForPruneAfterRevalidation':sorted(seen-keep),
        'objectWrites':0,'bucketWrites':0,'iamWrites':0,'runtimeInstalled':False}
