"""Bounded one-request database metadata worker; no arbitrary SQL."""
import contextlib
import importlib
import json
import os
from pathlib import Path
import platform
import re
import sqlite3
import ssl
import sys
import time

MAX_INPUT = 1024 * 1024
TIMEOUT = 10
MODULES = {'oracle': 'oracledb', 'postgresql': 'psycopg', 'mysql': 'pymysql', 'mariadb': 'pymysql', 'sqlserver': 'pyodbc', 'sqlite': 'sqlite3'}


class WorkerError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message
        super().__init__(message)


def invalid():
    raise WorkerError('INVALID_REQUEST', 'Invalid database request or connection settings.')


def validate(r):
    if not isinstance(r, dict) or r.get('action') not in ('diagnostics', 'test', 'schemas', 'tables', 'columns'):
        invalid()
    if r['action'] == 'diagnostics':
        return
    c = r.get('connection')
    if not isinstance(c, dict) or c.get('type') not in MODULES:
        invalid()
    for key in ('id', 'host', 'database', 'username', 'password', 'clientDir', 'sqlitePath', 'schema'):
        if key in c and (not isinstance(c[key], str) or len(c[key]) > 32768 or '\x00' in c[key]):
            invalid()
    for key, values in (('tlsMode', ('verify', 'disable')), ('oracleMode', ('thick', 'thin')), ('connectBy', ('service', 'sid'))):
        if key in c and c[key] not in values:
            invalid()
    if 'port' in c and (type(c['port']) is not int or not 1 <= c['port'] <= 65535):
        invalid()
    for key, default, low, high in (('limit', 100, 1, 200), ('offset', 0, 0, 2147483647)):
        v = r.get(key, default)
        if type(v) is not int or not low <= v <= high:
            invalid()
    for key in ('schema', 'table'):
        if key in r and (not isinstance(r[key], str) or not r[key] or '\x00' in r[key] or len(r[key]) > 1024):
            invalid()
    if r['action'] == 'columns' and not r.get('table'):
        invalid()
    if c['type'] == 'sqlite':
        if not c.get('sqlitePath'):
            invalid()
    elif not c.get('host') or not c.get('username'):
        invalid()
    if c['type'] in ('oracle', 'mysql', 'mariadb') and not c.get('database'):
        invalid()


def sanitized_error(exc):
    if isinstance(exc, WorkerError):
        return {'code': exc.code, 'message': exc.message}
    text = str(exc).lower()  # Inspect signatures, never return driver text.
    if isinstance(exc, ImportError):
        code, message = 'DRIVER_MISSING', 'Required Python database driver is not installed or could not be loaded.'
    elif any(x in text for x in ('dpi-1047', 'dpi-1072', 'oci.dll', 'oracle client')):
        code, message = 'ORACLE_CLIENT_MISSING', 'A compatible Oracle Instant Client is required for thick mode. Check clientDir and process architecture.'
    elif any(x in text for x in ('im002', 'im003', 'driver 18', "can't open lib")):
        code, message = 'ODBC_DRIVER_MISSING', 'Install Microsoft ODBC Driver 18 for SQL Server.'
    elif any(x in text for x in ('ora-01017', 'ora-28000', '28p01', '28000', '1045', '18456', 'authentication failed', 'login failed')):
        code, message = 'AUTH_FAILED', 'Database authentication failed. Check credentials and account status.'
    elif isinstance(exc, TimeoutError) or any(x in text for x in ('timeout', 'timed out', 'hyt00', 'hyt01', 'ora-12170', 'dpi-1067', 'dpy-4024')):
        code, message = 'TIMEOUT', 'Database connection or metadata request timed out.'
    elif any(x in text for x in ('certificate', 'ssl', 'tls')):
        code, message = 'TLS_FAILED', 'TLS verification failed. Check the server certificate and local trust configuration.'
    else:
        code, message = 'DATABASE_ERROR', 'Database operation failed. Check connection settings, permissions, and driver compatibility.'
    return {'code': code, 'message': message}


def diagnostics():
    drivers, odbc = {}, []
    for name in dict.fromkeys(MODULES.values()):
        try:
            m = importlib.import_module(name)
            version = getattr(m, '__version__', getattr(m, 'version', None))
            if name == 'sqlite3':
                version = sqlite3.sqlite_version
            drivers[name] = {'available': True, 'version': str(version) if version is not None else None}
            if name == 'pyodbc':
                odbc = list(m.drivers())
        except Exception:
            drivers[name] = {'available': False, 'version': None}
    return {'python': {'version': platform.python_version(), 'executable': sys.executable}, 'drivers': drivers, 'odbcDrivers': odbc,
            'oracleNote': 'Oracle 11.2 requires thick mode and a compatible Oracle Instant Client (typically 19c). Thin mode requires Oracle 12.1 or later. Driver availability does not verify client libraries or a database connection.'}


def close_connection(conn):
    if conn is not None:
        try:
            conn.rollback()
        except Exception:
            pass
        try:
            conn.close()
        except Exception:
            pass


def odbc_value(value):
    return '{' + str(value).replace('}', '}}') + '}'


def connect(c):
    kind = c['type']
    m = importlib.import_module(MODULES[kind])
    verify = c.get('tlsMode', 'verify') == 'verify'
    conn = None
    try:
        if kind == 'sqlite':
            path = Path(c['sqlitePath']).expanduser().resolve()
            if not path.is_file():
                raise WorkerError('SQLITE_FILE_MISSING', 'SQLite requires an existing database file.')
            conn = m.connect(path.as_uri() + '?mode=ro', uri=True, timeout=TIMEOUT)
            conn.execute('PRAGMA query_only = ON').close()
        elif kind == 'oracle':
            if c.get('oracleMode', 'thick') == 'thick':
                m.init_oracle_client(**({'lib_dir': c['clientDir']} if c.get('clientDir') else {}))
                if m.clientversion()[0] < 18:
                    raise WorkerError('ORACLE_CLIENT_UNSUPPORTED', 'Oracle Client 18 or later is required for call timeouts. Use Instant Client 19c for Oracle 11.2.')
            dsn = m.makedsn(c['host'], c.get('port', 1521), **{('sid' if c.get('connectBy') == 'sid' else 'service_name'): c['database']})
            dsn = dsn.replace('(DESCRIPTION=', '(DESCRIPTION=(CONNECT_TIMEOUT=10)(TRANSPORT_CONNECT_TIMEOUT=10)(RETRY_COUNT=0)', 1)
            conn = m.connect(user=c.get('username', ''), password=c.get('password', ''), dsn=dsn)
            conn.call_timeout = TIMEOUT * 1000
        elif kind == 'postgresql':
            conn = m.connect(host=c['host'], port=c.get('port', 5432), dbname=c.get('database', ''), user=c['username'], password=c.get('password', ''), connect_timeout=TIMEOUT,
                             sslmode='verify-full' if verify else 'disable', options='-c statement_timeout=10000 -c default_transaction_read_only=on')
        elif kind in ('mysql', 'mariadb'):
            args = dict(host=c['host'], port=c.get('port', 3306), database=c['database'], user=c['username'], password=c.get('password', ''), connect_timeout=TIMEOUT, read_timeout=TIMEOUT, write_timeout=TIMEOUT, charset='utf8mb4', autocommit=False)
            if verify:
                args['ssl'] = ssl.create_default_context()
            else:
                args['ssl_disabled'] = True
            conn = m.connect(defer_connect=True, **args)
            if verify:
                authenticate = conn._request_authentication

                def require_tls_authentication():
                    # PyMySQL otherwise falls back to plaintext without CLIENT_SSL.
                    # Reject before sending authentication data (PyMySQL 1.x).
                    if not conn.server_capabilities & m.constants.CLIENT.SSL:
                        raise WorkerError('TLS_FAILED', 'The database server does not support required TLS.')
                    return authenticate()

                conn._request_authentication = require_tls_authentication
            conn.connect()
        else:
            fields = {'DRIVER': 'ODBC Driver 18 for SQL Server', 'SERVER': c['host'] + ',' + str(c.get('port', 1433)), 'DATABASE': c.get('database', ''), 'UID': c['username'], 'PWD': c.get('password', ''), 'Encrypt': 'yes' if verify else 'no', 'TrustServerCertificate': 'no', 'APP': 'dsh-db-connect'}
            conn = m.connect(';'.join(k + '=' + odbc_value(v) for k, v in fields.items()) + ';', timeout=TIMEOUT, autocommit=False)
            conn.timeout = TIMEOUT
        return conn
    except Exception:
        close_connection(conn)
        raise


def query(conn, sql, params, count):
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        return cur.fetchmany(count)
    finally:
        cur.close()


def default_schema(c):
    return c.get('schema') or {'oracle': c.get('username', '').upper(), 'postgresql': 'public', 'mysql': c.get('database'), 'mariadb': c.get('database'), 'sqlserver': 'dbo', 'sqlite': 'main'}[c['type']]


def metadata(conn, r):
    c, action = r['connection'], r['action']
    kind, schema = c['type'], r.get('schema') or default_schema(c)
    limit, offset = r.get('limit', 100), r.get('offset', 0)
    count, params = limit + 1, []
    if kind == 'sqlite':
        if schema != 'main':
            raise WorkerError('INVALID_SCHEMA', 'SQLite supports the main schema only.')
        if action == 'schemas':
            rows = [('main',)][offset:offset + count]
        elif action == 'tables':
            rows = query(conn, "SELECT name, 'main', type FROM sqlite_master WHERE type IN ('table','view') AND name NOT GLOB 'sqlite_*' ORDER BY name LIMIT ? OFFSET ?", (count, offset), count)
        else:
            identifier = '"' + r['table'].replace('"', '""') + '"'
            cur = conn.cursor()
            try:
                cur.execute('PRAGMA main.table_info(' + identifier + ')')
                for _ in range(offset):
                    if cur.fetchone() is None:
                        break
                rows = [(v[1], v[2], not bool(v[3]), v[0] + 1) for v in cur.fetchmany(count)]
            finally:
                cur.close()
    else:
        if kind == 'oracle':
            if action == 'schemas':
                base, order = 'SELECT username FROM all_users', 'username'
            elif action == 'tables':
                base, order = "SELECT object_name, owner, object_type FROM all_objects WHERE owner = :1 AND object_type IN ('TABLE','VIEW')", 'object_name, object_type'
                params = [schema]
            else:
                base, order = 'SELECT column_name, data_type, nullable, column_id FROM all_tab_columns WHERE owner = :1 AND table_name = :2', 'column_id'
                params = [schema, r['table']]
            n = len(params)
            sql = 'SELECT * FROM (SELECT page_rows.*, ROWNUM page_number FROM (' + base + ' ORDER BY ' + order + ') page_rows WHERE ROWNUM <= :' + str(n + 1) + ') WHERE page_number > :' + str(n + 2) + ' ORDER BY page_number'
            params.extend([offset + count, offset])
        else:
            marker = '?' if kind == 'sqlserver' else '%s'
            if action == 'schemas':
                base, order = 'SELECT schema_name FROM information_schema.schemata', 'schema_name'
            elif action == 'tables':
                base, order = 'SELECT table_name, table_schema, table_type FROM information_schema.tables WHERE table_schema = ' + marker, 'table_name, table_type'
                params = [schema]
            else:
                base, order = 'SELECT column_name, data_type, is_nullable, ordinal_position FROM information_schema.columns WHERE table_schema = ' + marker + ' AND table_name = ' + marker, 'ordinal_position'
                params = [schema, r['table']]
            sql = base + ' ORDER BY ' + order
            if kind == 'sqlserver':
                sql += ' OFFSET ? ROWS FETCH NEXT ? ROWS ONLY'
                params.extend([offset, count])
            else:
                sql += ' LIMIT %s OFFSET %s'
                params.extend([count, offset])
        rows = query(conn, sql, tuple(params), count)
    items = []
    for row in rows[:limit]:
        if action == 'schemas':
            item = {'name': str(row[0])}
        elif action == 'tables':
            item = {'name': str(row[0]), 'schema': str(row[1]), 'kind': 'view' if 'VIEW' in str(row[2]).upper() else 'table'}
        else:
            item = {'name': str(row[0]), 'dataType': str(row[1]), 'nullable': row[2] is True or str(row[2]).upper() in ('YES', 'Y', '1'), 'ordinal': int(row[3])}
        items.append(item)
    return {'items': items, 'hasMore': len(rows) > limit, 'offset': offset, 'limit': limit}


def test_connection(conn, c, started):
    kind = c['type']
    if kind == 'oracle':
        version = conn.version
    elif kind == 'postgresql':
        version = conn.info.server_version
    elif kind in ('mysql', 'mariadb'):
        version = conn.get_server_info()
    elif kind == 'sqlite':
        version = sqlite3.sqlite_version
    else:
        version = conn.getinfo(importlib.import_module('pyodbc').SQL_DBMS_VER)
    match = re.search(r'\d+(?:\.\d+){0,5}', str(version))
    value = {'connected': True, 'databaseType': kind, 'serverVersion': match.group(0) if match else 'unknown', 'elapsedMs': round((time.monotonic() - started) * 1000), 'driver': MODULES[kind]}
    if kind == 'oracle':
        value['oracleMode'] = c.get('oracleMode', 'thick')
    return value


def dispatch(r):
    validate(r)
    if r['action'] == 'diagnostics':
        return diagnostics()
    started, conn = time.monotonic(), None
    try:
        conn = connect(r['connection'])
        return test_connection(conn, r['connection'], started) if r['action'] == 'test' else metadata(conn, r)
    finally:
        close_connection(conn)


def handle_bytes(data):
    try:
        if len(data) > MAX_INPUT:
            raise WorkerError('INPUT_TOO_LARGE', 'Request exceeds the 1 MiB input limit.')
        try:
            r = json.loads(data.decode('utf-8'), parse_constant=lambda _: invalid())
        except (ValueError, UnicodeError, RecursionError):
            raise WorkerError('INVALID_JSON', 'Expected one UTF-8 JSON object.') from None
        return {'ok': True, 'value': dispatch(r)}
    except Exception as exc:
        return {'ok': False, 'error': sanitized_error(exc)}


def main():
    # Suppress Python/native driver chatter; duplicate stdout for one response.
    output_fd = os.dup(sys.stdout.fileno())
    with os.fdopen(output_fd, 'w', encoding='utf-8', newline='\n') as output:
        with open(os.devnull, 'w', encoding='utf-8') as sink:
            os.dup2(sink.fileno(), 1)
            os.dup2(sink.fileno(), 2)
            with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
                try:
                    encoded = json.dumps(handle_bytes(sys.stdin.buffer.read(MAX_INPUT + 1)), ensure_ascii=True, allow_nan=False)
                except Exception:
                    encoded = '{"ok":false,"error":{"code":"INTERNAL_ERROR","message":"Database worker failed."}}'
            output.write(encoded + '\n')
            output.flush()


if __name__ == '__main__':
    main()
