import sys
from pathlib import Path
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import web_services_guest as services
from p4_recovery_guest import RecoveryError


class WebServicesTests(unittest.TestCase):
    def test_only_existing_private_backend_network_is_allowed(self):
        def container(network,address):return {'NetworkSettings':{'Networks':{network:{'IPAddress':address}}}}
        self.assertEqual(services.private_address(container('ir35-staging_backend','172.22.0.4')),'172.22.0.4')
        for network,address in [('bridge','172.22.0.4'),('ir35-staging_backend','8.8.8.8'),('ir35-staging_backend','127.0.0.1')]:
            with self.assertRaises(RecoveryError):services.private_address(container(network,address))

    def test_bad_preparation_fails_before_database_or_docker(self):
        with patch.object(services,'require_prepared',side_effect=RecoveryError('FixtureSealMismatch')),patch.object(services,'Recovery') as recovery:
            with self.assertRaisesRegex(RecoveryError,'FixtureSealMismatch'):services.start({}, {})
        recovery.assert_not_called()


if __name__=='__main__':unittest.main()
