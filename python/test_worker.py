import json
from pathlib import Path
import sqlite3
import ssl
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import worker


def config(kind, **extra):
    return dict(type=kind, host='db.example', username='user', password='secret', database='example', **extra)


class DriverTests(unittest.TestCase):
    def module(self):
        m = Mock()
        m.makedsn.return_value = '(DESCRIPTION=(ADDRESS=example))'
        m.clientversion.return_value = (19, 3, 0, 0, 0)
        m.connect.return_value.version = '11.2.0.4.0'
        return m

    def test_oracle_default_thick_service_and_timeout(self):
        m = self.module()
        with patch.object(worker.importlib, 'import_module', return_value=m):
            result = worker.dispatch({'action': 'test', 'connection': config('oracle', clientDir='client')})
        m.init_oracle_client.assert_called_once_with(lib_dir='client')
        m.makedsn.assert_called_once_with('db.example', 1521, service_name='example')
        self.assertIn('(CONNECT_TIMEOUT=10)', m.connect.call_args.kwargs['dsn'])
        self.assertEqual(m.connect.return_value.call_timeout, 10000)
        self.assertEqual(result['oracleMode'], 'thick')
        self.assertNotIn('secret', json.dumps(result))
        m.connect.return_value.rollback.assert_called_once()
        m.connect.return_value.close.assert_called_once()

    def test_oracle_thin_sid(self):
        m = self.module()
        with patch.object(worker.importlib, 'import_module', return_value=m):
            worker.connect(config('oracle', oracleMode='thin', connectBy='sid'))
        m.init_oracle_client.assert_not_called()
        m.makedsn.assert_called_once_with('db.example', 1521, sid='example')

    def test_postgres_tls_and_timeouts(self):
        for tls, expected in [('verify', 'verify-full'), ('disable', 'disable')]:
            m = self.module()
            with patch.object(worker.importlib, 'import_module', return_value=m):
                worker.connect(config('postgresql', tlsMode=tls))
            args = m.connect.call_args.kwargs
            self.assertEqual(args['sslmode'], expected)
            self.assertEqual(args['connect_timeout'], 10)
            self.assertIn('statement_timeout=10000', args['options'])
        with patch.object(worker.importlib, 'import_module', return_value=m):
            worker.connect(config('postgresql'))
        self.assertEqual(m.connect.call_args.kwargs['sslmode'], 'verify-full')

    def test_mysql_and_mariadb_tls(self):
        for kind in ('mysql', 'mariadb'):
            m = self.module()
            with patch.object(worker.importlib, 'import_module', return_value=m):
                worker.connect(config(kind))
                args = m.connect.call_args.kwargs
                self.assertTrue(args['ssl'].check_hostname)
                self.assertEqual(args['ssl'].verify_mode, ssl.CERT_REQUIRED)
                self.assertEqual(args['read_timeout'], 10)
                worker.connect(config(kind, tlsMode='disable'))
                self.assertTrue(m.connect.call_args.kwargs['ssl_disabled'])

    def test_mysql_rejects_plaintext_before_authentication(self):
        for supports_tls in (False, True):
            m = self.module()
            m.constants.CLIENT.SSL = 2048
            conn = m.connect.return_value
            conn.server_capabilities = 2048 if supports_tls else 0
            authenticate = conn._request_authentication
            conn.connect.side_effect = lambda: conn._request_authentication()
            with patch.object(worker.importlib, 'import_module', return_value=m):
                if supports_tls:
                    worker.connect(config('mysql'))
                    authenticate.assert_called_once()
                else:
                    with self.assertRaises(worker.WorkerError) as caught:
                        worker.connect(config('mysql'))
                    self.assertEqual(caught.exception.code, 'TLS_FAILED')
                    authenticate.assert_not_called()
                    conn.close.assert_called_once()

    def test_oracle_old_client_rejected_before_connect(self):
        m = self.module()
        m.clientversion.return_value = (12, 2, 0, 0, 0)
        with patch.object(worker.importlib, 'import_module', return_value=m):
            with self.assertRaises(worker.WorkerError) as caught:
                worker.connect(config('oracle'))
        self.assertEqual(caught.exception.code, 'ORACLE_CLIENT_UNSUPPORTED')
        m.connect.assert_not_called()

    def test_sqlserver_escaping_tls(self):
        m = self.module()
        c = config('sqlserver')
        c['password'] = 'x};Encrypt=no;PWD=y'
        with patch.object(worker.importlib, 'import_module', return_value=m):
            worker.connect(c)
        text = m.connect.call_args.args[0]
        self.assertIn('PWD={x}};Encrypt=no;PWD=y}', text)
        self.assertIn('DRIVER={ODBC Driver 18 for SQL Server}', text)
        self.assertIn('Encrypt={yes};TrustServerCertificate={no}', text)
        self.assertEqual(m.connect.return_value.timeout, 10)
        with patch.object(worker.importlib, 'import_module', return_value=m):
            worker.connect(config('sqlserver', tlsMode='disable'))
        self.assertIn('Encrypt={no}', m.connect.call_args.args[0])

    def test_metadata_binding_and_pagination_all_remote_drivers(self):
        for kind in ('oracle', 'postgresql', 'mysql', 'mariadb', 'sqlserver'):
            for action in ('schemas', 'tables', 'columns'):
                with self.subTest(kind=kind, action=action):
                    conn = Mock()
                    rows = {'schemas': [('a',), ('b',)], 'tables': [('a', 's', 'BASE TABLE'), ('b', 's', 'VIEW')], 'columns': [('a', 'TEXT', 'YES', 1), ('b', 'INT', 'NO', 2)]}[action]
                    conn.cursor.return_value.fetchmany.return_value = rows
                    r = {'action': action, 'connection': config(kind), 'schema': "s'--", 'table': "t'--", 'limit': 1, 'offset': 3}
                    value = worker.metadata(conn, r)
                    sql, params = conn.cursor.return_value.execute.call_args.args
                    self.assertNotIn("s'--", sql)
                    self.assertNotIn("t'--", sql)
                    if action != 'schemas':
                        self.assertEqual(params[0], "s'--")
                    if action == 'columns':
                        self.assertEqual(params[1], "t'--")
                    self.assertEqual(params[-2:], (5, 3) if kind == 'oracle' else ((3, 2) if kind == 'sqlserver' else (2, 3)))
                    conn.cursor.return_value.fetchmany.assert_called_once_with(2)
                    conn.cursor.return_value.close.assert_called_once()
                    self.assertTrue(value['hasMore'])
                    self.assertEqual(len(value['items']), 1)
                    if kind == 'oracle':
                        self.assertNotIn('OFFSET', sql)

    def test_cleanup_on_query_failure(self):
        conn = Mock()
        conn.cursor.return_value.execute.side_effect = RuntimeError('secret')
        with patch.object(worker, 'connect', return_value=conn):
            result = worker.handle_bytes(json.dumps({'action': 'tables', 'connection': config('postgresql')}).encode())
        self.assertFalse(result['ok'])
        self.assertNotIn('secret', json.dumps(result))
        conn.cursor.return_value.close.assert_called_once()
        self.assertEqual([call[0] for call in conn.method_calls][-2:], ['rollback', 'close'])

    def test_diagnostics_never_connects(self):
        m = self.module()
        m.__version__ = '1.2.3'
        m.drivers.return_value = ['ODBC Driver 18 for SQL Server']
        with patch.object(worker.importlib, 'import_module', return_value=m):
            result = worker.dispatch({'action': 'diagnostics'})
        m.connect.assert_not_called()
        m.init_oracle_client.assert_not_called()
        self.assertIn('ODBC Driver 18 for SQL Server', result['odbcDrivers'])
        self.assertIn('executable', result['python'])


class SQLiteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'db #% 测试.sqlite'
        conn = sqlite3.connect(self.path)
        conn.executescript('CREATE TABLE "odd""; --" ("col""umn" TEXT NOT NULL, n INTEGER); CREATE TABLE z (x BLOB); CREATE VIEW v AS SELECT * FROM z;')
        conn.close()
        self.c = {'type': 'sqlite', 'sqlitePath': str(self.path)}

    def test_read_only_and_query_only(self):
        conn = worker.connect(self.c)
        try:
            self.assertEqual(conn.execute('PRAGMA query_only').fetchone()[0], 1)
            with self.assertRaises(sqlite3.OperationalError):
                conn.execute('CREATE TABLE forbidden (x)')
            conn.execute('PRAGMA query_only=OFF')
            with self.assertRaises(sqlite3.OperationalError):
                conn.execute('CREATE TABLE forbidden (x)')
        finally:
            worker.close_connection(conn)

    def test_missing_file_not_created(self):
        missing = Path(self.temp.name) / 'missing.sqlite'
        result = worker.handle_bytes(json.dumps({'action': 'test', 'connection': {'type': 'sqlite', 'sqlitePath': str(missing)}}).encode())
        self.assertEqual(result['error']['code'], 'SQLITE_FILE_MISSING')
        self.assertFalse(missing.exists())

    def test_unusual_identifiers_and_pagination(self):
        r = {'action': 'columns', 'connection': self.c, 'table': 'odd"; --', 'limit': 1}
        v = worker.dispatch(r)
        self.assertEqual(v['items'], [{'name': 'col"umn', 'dataType': 'TEXT', 'nullable': False, 'ordinal': 1}])
        self.assertTrue(v['hasMore'])
        v = worker.dispatch(dict(r, offset=1))
        self.assertEqual(v['items'][0]['name'], 'n')
        self.assertFalse(v['hasMore'])
        tables = worker.dispatch({'action': 'tables', 'connection': self.c, 'limit': 2})
        self.assertTrue(tables['hasMore'])
        self.assertEqual(tables['items'][1]['kind'], 'view')
        self.assertEqual(worker.dispatch({'action': 'schemas', 'connection': self.c})['items'], [{'name': 'main'}])
        self.assertTrue(worker.dispatch({'action': 'test', 'connection': self.c})['connected'])

    def test_unknown_schema_and_injection(self):
        with self.assertRaises(worker.WorkerError):
            worker.dispatch({'action': 'tables', 'connection': self.c, 'schema': 'attached'})
        result = worker.dispatch({'action': 'columns', 'connection': self.c, 'table': 'x"); DROP TABLE z; --'})
        self.assertEqual(result['items'], [])
        self.assertEqual(len(worker.dispatch({'action': 'tables', 'connection': self.c})['items']), 3)


class ProtocolTests(unittest.TestCase):
    def test_invalid_protocol(self):
        for raw in (b'', b'{}{}', b'[]', b'null', b'\xff', b'{"action":"execute","sql":"DROP TABLE x"}'):
            result = worker.handle_bytes(raw)
            self.assertFalse(result['ok'])
            self.assertEqual(set(result['error']), {'code', 'message'})
        self.assertEqual(worker.handle_bytes(b' ' * (worker.MAX_INPUT + 1))['error']['code'], 'INPUT_TOO_LARGE')

    def test_invalid_bounds(self):
        for key, values in [('limit', [0, 201, True, 1.5]), ('offset', [-1, True, 1.5]), ('port', [0, 65536, True])]:
            for value in values:
                r = {'action': 'test', 'connection': config('postgresql')}
                (r['connection'] if key == 'port' else r)[key] = value
                self.assertEqual(worker.handle_bytes(json.dumps(r).encode())['error']['code'], 'INVALID_REQUEST')

    def test_sanitized_driver_errors(self):
        for exc, code in [(ModuleNotFoundError('secret'), 'DRIVER_MISSING'), (RuntimeError('DPI-1047 secret'), 'ORACLE_CLIENT_MISSING'), (RuntimeError('ORA-01017 secret'), 'AUTH_FAILED'), (TimeoutError('secret'), 'TIMEOUT'), (RuntimeError('IM002 secret'), 'ODBC_DRIVER_MISSING'), (RuntimeError('certificate secret'), 'TLS_FAILED'), (RuntimeError('secret'), 'DATABASE_ERROR')]:
            v = worker.sanitized_error(exc)
            self.assertEqual(v['code'], code)
            self.assertNotIn('secret', json.dumps(v))

    def test_subprocess_one_response_no_stderr(self):
        for raw in (b'{"action":"diagnostics"}', b'{broken secret', b' ' * (worker.MAX_INPUT + 1)):
            process = subprocess.run([sys.executable, '-B', str(Path(worker.__file__))], input=raw, capture_output=True, timeout=15)
            self.assertEqual(process.returncode, 0)
            self.assertEqual(process.stderr, b'')
            self.assertEqual(len(process.stdout.splitlines()), 1)
            result = json.loads(process.stdout)
            self.assertIn('ok', result)
            self.assertNotIn('secret', process.stdout.decode())


if __name__ == '__main__':
    unittest.main()
