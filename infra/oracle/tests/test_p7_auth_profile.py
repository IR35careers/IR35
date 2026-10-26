import copy
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p7_auth_profile as profile
import export_auth_settings as exporter


def fixture():
    values={name:False if bool in types else 0 if int in types else '' for name,types in exporter.ALLOWLIST.items()}
    values.update(external_email_enabled=True,mailer_autoconfirm=False,external_google_enabled=True,
        external_google_client_id='public-fixture.apps.googleusercontent.com',smtp_max_frequency=60,mailer_otp_exp=3600,
        mailer_otp_length=6,password_min_length=8,refresh_token_rotation_enabled=True,security_refresh_token_reuse_interval=10,
        mailer_secure_email_change_enabled=True)
    for kind in exporter.TEMPLATES:
        values['mailer_templates_'+kind+'_content']='<a href="{{ .ConfirmationURL }}">Fixture</a>'
        values['mailer_subjects_'+kind]="You're invited" if kind=='invite' else 'Fixture subject'
    return {'format':'ir35-p7-source-v1','source_sha256':profile.SOURCE_SHA,'supplement_sha256':profile.SUPPLEMENT_SHA,'settings':values}


class AuthProfileTests(unittest.TestCase):
    def test_staging_mapping_preserves_controls_and_never_imports_secrets_or_enables_provider(self):
        source=fixture();original=copy.deepcopy(source)
        auth,templates,subjects,report=profile.configure({'GOTRUE_JWT_SECRET':'existing-staging-only-fixture'},source,'ir35-p4-fixture-templates')
        self.assertEqual(source,original);self.assertEqual(auth['GOTRUE_JWT_SECRET'],'existing-staging-only-fixture')
        self.assertEqual(auth['GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED'],'true')
        self.assertEqual(auth['GOTRUE_SMTP_MAX_FREQUENCY'],'60s');self.assertEqual(auth['GOTRUE_PASSWORD_REQUIRED_CHARACTERS'],'')
        self.assertEqual(auth['GOTRUE_EXTERNAL_GOOGLE_ENABLED'],'false');self.assertEqual(auth['GOTRUE_EXTERNAL_GOOGLE_SKIP_NONCE_CHECK'],'false')
        self.assertNotIn('GOTRUE_SESSIONS_TIMEBOX',auth);self.assertEqual(auth['GOTRUE_SMTP_HOST'],'smtp')
        self.assertEqual(auth['GOTRUE_SMTP_USER'],'');self.assertEqual(auth['GOTRUE_SMTP_PASS'],'')
        self.assertEqual(report['deferredProviderFieldNames'],['external_google_enabled']);self.assertFalse(report['providerLoginProven'])
        self.assertEqual(templates['recovery'],source['settings']['mailer_templates_recovery_content'])
        self.assertEqual(subjects['GOTRUE_MAILER_SUBJECTS_INVITE'],"You're invited")
    def test_apostrophe_subject_uses_public_only_env_file_not_relaxed_secret_encoder(self):
        line=profile.subject_env({'GOTRUE_MAILER_SUBJECTS_INVITE':"You're invited"})
        self.assertEqual(line,"GOTRUE_MAILER_SUBJECTS_INVITE=You're invited\n")
        for values in ({'GOTRUE_JWT_SECRET':'not-permitted'},{'GOTRUE_MAILER_SUBJECTS_INVITE':'bad\nEVIL=value'}):
            with self.assertRaises(profile.ProfileError):profile.subject_env(values)
    def test_credentials_unknown_fields_or_changed_binding_are_refused(self):
        for mutation in ('secret','binding','token','null'):
            data=fixture()
            if mutation=='secret':data['settings']['smtp_pass']='not-permitted'
            elif mutation=='binding':data['source_sha256']='0'*64
            elif mutation=='token':data['settings']['site_url']='sbp_fixture_credential_not_permitted'
            else:data['settings']['password_required_characters']=None
            with self.assertRaises(profile.ProfileError):profile.validate(data)
    def test_real_external_controls_fail_before_container_or_network_action(self):
        for name in profile.SENSITIVE_CONTROLS:
            data=fixture();data['settings'][name]=True
            with self.assertRaises(profile.ProfileError):profile.validate(data)
        data=fixture();data['settings']['hook_send_email_enabled']=True
        with self.assertRaises(profile.ProfileError):profile.validate(data)
    def test_positive_session_duration_is_explicit_seconds_and_negative_is_rejected(self):
        data=fixture();data['settings']['sessions_timebox']=3600
        auth,_,_,_=profile.configure({},data,'ir35-p4-fixture-templates');self.assertEqual(auth['GOTRUE_SESSIONS_TIMEBOX'],'3600s')
        data['settings']['sessions_timebox']=-1
        with self.assertRaises(profile.ProfileError):profile.configure({},data,'ir35-p4-fixture-templates')


if __name__=='__main__':unittest.main()
