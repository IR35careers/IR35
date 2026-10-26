import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import fill_auth_supplement as supplement
import confirm_auth_supplement as confirmation
from test_fill_auth_supplement import fixture


class OwnerConfirmationTests(unittest.TestCase):
    def api_nulls(self,target):
        document=json.loads(target.read_text())
        document['source_observations']={name:{'state':'explicit_null','source_type':'null'} for name in supplement.FIELDS}
        target.write_text(json.dumps(document,sort_keys=True,indent=2)+'\n')
        return hashlib.sha256(target.read_bytes()).hexdigest()

    def test_exact_owner_confirmation_preserves_api_archive_and_original_and_is_idempotent(self):
        with fixture() as (source,target):
            before=self.api_nulls(target);source_before=source.read_bytes();api_before=target.read_bytes()
            with patch.object(supplement,'OWNER_NONE_API_SHA256',before):
                result=confirmation.confirm()
                self.assertEqual(result['status'],'PASS');self.assertTrue(result['g3Closed'])
                archive=target.with_name('oracle-auth-settings-supplement-api-'+before+'.json')
                self.assertEqual(archive.read_bytes(),api_before);self.assertEqual(source.read_bytes(),source_before)
                document,after=supplement.load()
                self.assertEqual(document['settings'],{name:'' for name in supplement.FIELDS})
                self.assertEqual(document['source_observations'],{name:{'state':'explicit_null','source_type':'null'} for name in supplement.FIELDS})
                self.assertEqual(document['owner_confirmation'],supplement.owner_none_confirmation())
                confirmed=target.read_bytes();again=confirmation.confirm()
                self.assertTrue(again['alreadyConfirmed']);self.assertEqual(target.read_bytes(),confirmed)
            archive.chmod(0o600)

    def test_unattested_or_changed_api_input_cannot_be_confirmed(self):
        for mutation in ('missing_observations','changed_hash','populated'):
            with fixture() as (source,target):
                before=self.api_nulls(target)
                if mutation=='missing_observations':
                    doc=json.loads(target.read_text());del doc['source_observations'];target.write_text(json.dumps(doc))
                elif mutation=='populated':
                    doc=json.loads(target.read_text());doc['settings'][supplement.FIELDS[0]]='existing';del doc['source_observations'][supplement.FIELDS[0]];target.write_text(json.dumps(doc))
                protected=target.read_bytes()
                with patch.object(supplement,'OWNER_NONE_API_SHA256',before if mutation!='changed_hash' else '0'*64):
                    with self.assertRaises(supplement.SupplementRefused):confirmation.confirm()
                self.assertEqual(target.read_bytes(),protected)

    def test_forged_or_broader_owner_metadata_rejected(self):
        with fixture() as (source,target):
            document=json.loads(target.read_text());document['settings']={name:'' for name in supplement.FIELDS}
            document['source_observations']={name:{'state':'explicit_null','source_type':'null'} for name in supplement.FIELDS}
            for invalid in ({'authority':'guessed-default'},supplement.owner_none_confirmation()|{'field_names':['smtp_pass']}):
                document['owner_confirmation']=invalid
                with self.assertRaises(supplement.SupplementRefused):supplement.validate_document(document,supplement.SOURCE_SHA256)
            document['owner_confirmation']=supplement.owner_none_confirmation();document['settings'][supplement.FIELDS[0]]='not-none'
            with self.assertRaises(supplement.SupplementRefused):supplement.validate_document(document,supplement.SOURCE_SHA256)

    def test_regular_exporter_still_cannot_overwrite_confirmed_settings(self):
        with fixture() as (source,target):
            before=self.api_nulls(target)
            with patch.object(supplement,'OWNER_NONE_API_SHA256',before):
                confirmation.confirm();document,snapshot=supplement.load();protected=target.read_bytes()
                document['settings'][supplement.FIELDS[0]]='different'
                with self.assertRaises(supplement.SupplementRefused):supplement.write_supplement(document,snapshot)
                self.assertEqual(target.read_bytes(),protected)
            target.with_name('oracle-auth-settings-supplement-api-'+before+'.json').chmod(0o600)


if __name__=='__main__':unittest.main()
