"""Exact-zero accounting is not a billing, currency or eligibility waiver."""
from copy import deepcopy
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import resource_audit as audit
import p8_oci_readonly
from key_ceremony import KeySafetyError
from test_resource_audit import ACCOUNT, FixtureClient
from test_p8_oci_readonly import report as approved_envelope


class NeutralZeroCostMetadataTests(unittest.TestCase):
    def inventory(self, items):
        denied=AssertionError('Native_auth_or_private_write_forbidden')
        with patch.object(audit.subprocess,'run',side_effect=denied) as process, \
                patch.object(audit,'ensure_session',side_effect=denied) as auth, \
                patch.object(audit,'write_new',side_effect=denied) as write:
            result=audit.inventory(FixtureClient({'costSummary':{'items':items}}),ACCOUNT)
        process.assert_not_called()
        auth.assert_not_called()
        write.assert_not_called()
        return result

    def test_observed_space_zero_and_iso_zero_are_both_accounted_without_currency_inference(self):
        result=self.inventory([{'currency':' ','computed-amount':0.0},
                               {'currency':'GBP','computed-amount':0.0}])
        cost=result['costReport']
        self.assertEqual(cost['rows'],2)
        self.assertEqual(cost['amounts'],{'GBP':{'net':'0.0','positive':'0.0'}})
        self.assertEqual(cost['neutralZeroRowCount'],1)
        self.assertEqual(cost['neutralZeroRows'],[{'rowIndex':1,
            'currencySHA256':hashlib.sha256(b' ').hexdigest(),'knownZero':True}])
        self.assertFalse(cost['realTimeZeroBillProven'])
        self.assertTrue(cost['mayLag'])
        self.assertEqual(result['freeTierCreateGate'],'NOT_PASSED')
        self.assertEqual(result['infrastructureCreates'],0)

    def test_every_row_is_accounted_with_one_based_indices_not_skipped_or_relabelled(self):
        items=[{'currency':'GBP','computed-amount':'2.00'},
               {'currency':' ','computed-amount':'0.000'},
               {'currency':'USD','computed-amount':'3'},
               {'currency':'   ','computed-amount':-0.0},
               {'currency':'GBP','computed-amount':'-2.00'}]
        before=deepcopy(items)
        cost=self.inventory(items)['costReport']
        self.assertEqual(items,before)
        self.assertEqual(cost['rows'],len(items))
        self.assertEqual(cost['neutralZeroRowCount'],2)
        self.assertEqual([row['rowIndex'] for row in cost['neutralZeroRows']],[2,4])
        self.assertEqual([row['currencySHA256'] for row in cost['neutralZeroRows']],
            [hashlib.sha256(label.encode('ascii')).hexdigest() for label in (' ','   ')])
        self.assertEqual(cost['amounts'],{'GBP':{'net':'0.00','positive':'2.00'},
                                         'USD':{'net':'3','positive':'3'}})

    def test_only_exact_finite_decimal_zero_is_neutral(self):
        for value in (0,0.0,-0.0,'0','-0','0.000','0E-100',' 0 '):
            with self.subTest(amount_type=type(value).__name__):
                costs,neutral=audit.cost_totals([{'currency':' ','computed-amount':value}])
                self.assertEqual(costs,{})
                self.assertEqual(len(neutral),1)
                self.assertTrue(neutral[0]['knownZero'])
        for value in (1,-1,0.0001,-0.0001,'1E-100000','-1E-100000'):
            with self.subTest(nonzero_type=type(value).__name__):
                with self.assertRaisesRegex(KeySafetyError,'Cost currency is unverified'):
                    audit.cost_totals([{'currency':' ','computed-amount':value}])

    def test_missing_null_empty_controls_unicode_and_other_invalid_currencies_still_fail(self):
        values=(None,False,0,[],{},'', '\t','\n',' \n','\r','\x00','\u00a0',' \u00a0',
                'gbp',' GBP','GBP ','N/A','GB P','private-currency-sentinel')
        for value in values:
            with self.subTest(currency_type=type(value).__name__):
                with self.assertRaisesRegex(KeySafetyError,'Cost currency is unverified') as error:
                    audit.cost_totals([{'currency':value,'computed-amount':0.0}])
                self.assertNotIn('private-currency-sentinel',str(error.exception))
        with self.assertRaisesRegex(KeySafetyError,'Cost currency is unverified'):
            audit.cost_totals([{'computed-amount':0.0}])

    def test_unknown_boolean_nonfinite_and_invalid_amounts_fail_for_space_and_iso(self):
        values=(None,True,False,[],{},Decimal(0),float('nan'),float('inf'),-float('inf'),
                'NaN','sNaN','Infinity','-Infinity','','private-amount-sentinel')
        for currency in (' ','GBP'):
            for value in values:
                with self.subTest(currency_kind='space' if currency==' ' else 'iso',amount_type=type(value).__name__):
                    with self.assertRaises(KeySafetyError) as error:
                        audit.cost_totals([{'currency':currency,'computed-amount':value}])
                    self.assertNotIn('private-amount-sentinel',str(error.exception))
            with self.assertRaises(KeySafetyError):audit.cost_totals([{'currency':currency}])

    def test_positive_iso_cost_is_never_hidden_by_neutral_zero_or_credit(self):
        result=self.inventory([{'currency':' ','computed-amount':0.0},
                               {'currency':'GBP','computed-amount':'1.60'},
                               {'currency':'GBP','computed-amount':'-1.60'}])
        self.assertEqual(result['costReport']['rows'],3)
        self.assertEqual(result['costReport']['amounts']['GBP'],{'net':'0.00','positive':'1.60'})
        candidate=approved_envelope()
        candidate['costReport']=result['costReport']
        with self.assertRaisesRegex(KeySafetyError,'PositiveReportedCost_Stop_NoCreditOffset'):
            p8_oci_readonly.envelope(candidate)

    def test_invalid_nonzero_currency_credit_cannot_offset_any_iso_cost(self):
        for amount in ('-1.60','1.60'):
            with self.assertRaisesRegex(KeySafetyError,'Cost currency is unverified'):
                self.inventory([{'currency':'GBP','computed-amount':'1.60'},
                                {'currency':' ','computed-amount':amount}])

    def test_neutral_metadata_never_includes_raw_provider_fields(self):
        private='private-provider-sentinel-not-for-evidence'
        result=self.inventory([{'currency':'  ','computed-amount':0.0,'service':private,
                                'resource-id':private,'tags':{'token':private},'unexpected':private}])
        cost=result['costReport']
        self.assertEqual(cost['amounts'],{})
        self.assertEqual(set(cost['neutralZeroRows'][0]),{'rowIndex','currencySHA256','knownZero'})
        encoded=json.dumps(result)
        self.assertNotIn(private,encoded)
        self.assertNotIn('"currency":',encoded)
        self.assertNotIn('computed-amount',encoded)
        self.assertNotIn('ocid1',encoded)
        self.assertFalse(cost['realTimeZeroBillProven'])
        self.assertEqual(result['freeTierCreateGate'],'NOT_PASSED')

    def test_empty_and_iso_only_results_keep_original_cost_semantics(self):
        cost=self.inventory([])['costReport']
        self.assertEqual(cost['rows'],0)
        self.assertEqual(cost['amounts'],{})
        self.assertEqual(cost['neutralZeroRows'],[])
        self.assertEqual(cost['neutralZeroRowCount'],0)
        costs,neutral=audit.cost_totals([{'currency':'GBP','computed-amount':'-1.5'},
                                       {'currency':'GBP','computed-amount':'0.5'}])
        self.assertEqual(costs,{'GBP':{'net':Decimal('-1.0'),'positive':Decimal('0.5')}})
        self.assertEqual(neutral,[])


if __name__=='__main__':unittest.main()
