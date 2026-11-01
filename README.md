# DSH Database Connections

English | [中文](README.zh.md)

An independent DeepSeek Harness plugin for intranet database connections, driver diagnostics, connection testing, and paged schema → table → column browsing. It has no dependency on HZsql, SQLBot, hz-workbench, traffic-domain assets, or their credentials.

## Features and scope

- Oracle, PostgreSQL, MySQL, MariaDB, SQL Server, and SQLite.
- Oracle Thick/Thin modes, Service Name/SID, and explicit Oracle Client directory.
- Windows CurrentUser DPAPI encryption at rest. No password echo, command-line secrets, or credentials in model tool arguments/results.
- Per-connection assistant metadata access, disabled by default.
- Shared Host application service for UI and model tools; bounded subprocesses, cancellation and deadlines.
- English/Chinese UI using DSH theme tokens.

Version 0.1.0 manages **connections and metadata only**. It does not execute arbitrary SQL, read application rows, write to databases, or provide a semantic layer. Redis, MongoDB, Dameng and other engines are not implemented.

## Installation

The API baseline is DSH `0.2.1-rc.3`; the manifest admits `>=0.2.1-rc.3 <0.3.0`, without claiming that every admitted release has been tested. The old DSH 0.1.6 desktop is not compatible.

1. Download `dsh-db-connect-0.1.0.tgz` from [GitHub Releases](https://github.com/stitchmaps/dsh-db-connect/releases), or clone this repository. Install the archive or repository directory through the current DSH plugin manager using its local-package installation capability and an absolute path. Do not also append an insert entry manually.
2. Prepare a separate Python environment (Windows x64 Python 3.12 recommended). SQLite uses only the standard library. Other drivers are listed in `python/requirements.txt`.
3. Open **Databases → Runtime**, set the interpreter's absolute executable path, and run diagnostics. If left blank, the Host uses `DSH_DB_PYTHON`, then Python on PATH. It does not depend on DSH's private bundled runtime layout.
4. Add/save a connection, then test it and browse its structure. Saving alone does not connect.
5. Enable assistant access explicitly if wanted.

Changing the Python path clears existing passwords and assistant grants, preventing a replacement executable from inheriting secrets. Changing endpoint, username, database, Oracle mode/client directory, or TLS configuration requires reentering an existing password. Configure the interpreter before adding connections.

The plugin does not download packages or contact public services at startup. DSH supplies the `@deepseek-ai/dsh-tools` peer package.

## Driver matrix

| Database | Driver | Requirements |
|---|---|---|
| Oracle 11.2 | `oracledb==3.4.2`, Thick | Oracle Client **19c Basic**, matching Python architecture, Windows VC runtime, validated server patch |
| Oracle 12.1+ | Same, Thin or Thick | Thin needs no OCI libraries; Thin cannot connect to Oracle 11g |
| PostgreSQL | `psycopg[binary]` 3.x | TLS `verify-full` by default; trusted internal CA configuration |
| MySQL / MariaDB | `PyMySQL[rsa]` 1.x | Certificate verification by default; rejects pre-authentication plaintext fallback |
| SQL Server | `pyodbc` 5.x | Separately installed ODBC Driver 18; SQL Server 2012+ metadata pagination; username/password authentication |
| SQLite | Python `sqlite3` | Existing absolute file path; URI `mode=ro` and `query_only` |

Oracle public documentation summarizes Client 19 interoperability as DB 11.2+, but exact patch certification is delegated to Oracle's support matrix. Prefer 11.2.0.4 as a validation target; do not assume every 11.2 patch is supported or that .4 is the universal minimum. Thick mode requires Client 18+ in this plugin to support call deadlines; **Client 19** is the appropriate recommendation for 11.2, not newer Client 21/23. The pinned python-oracledb version retains a historical release-tested matrix including 11.2; it does not establish that this plugin has connected to your server.

Use Basic rather than Basic Light for legacy Chinese encodings. Oracle uses TCP Service/SID only in this release; TCPS wallets/TNS aliases/Kerberos are not implemented. Each operation owns a separate worker so different OCI profiles never share process-wide initialization.

## Offline deployment

Use matching OS, architecture and Python major/minor versions on preparation and target machines.

```powershell
# Online preparation machine
.\scripts\prepare-offline.ps1 -PythonExe 'C:\Python312\python.exe' -Wheelhouse 'D:\transfer\db-wheels'

# Offline target, after copying the complete wheelhouse and plugin
.\scripts\setup-runtime.ps1 -PythonExe 'C:\Python312\python.exe' -Wheelhouse 'D:\transfer\db-wheels' -Venv 'D:\apps\dsh-db-python'
```

Preparation downloads binary wheels and writes an environment + SHA-256 manifest. Setup checks all listed files, rejects unlisted files and incompatible Python/platform versions, creates a new venv and installs with `--no-index`. The wheelhouse freezes that preparation's resolved dependency set; installed versions are recorded in `installed-requirements.txt`. The manifest provides transfer integrity, not signature authentication. Obtain it through a trusted channel.

Python, Oracle Client/VC runtime and SQL Server ODBC installers must be supplied separately under their licenses. No native clients or wheelhouse are included in the plugin archive. SQLite needs no pip dependencies. Driver diagnostics checks imports, not full native-client initialization or network reachability.

## Model tools

- `db_connections`: IDs, labels, types and revisions of explicitly enabled connections only.
- `db_inspect`: `test`, `schemas`, `tables`, `columns`. Pages default to 100 rows, maximum 200; use `hasMore` and `offset`.

Tools cannot create profiles, change secrets, grant themselves access, or change Python settings. Metadata is untrusted data, not instructions. Enabling access sends metadata into model context; use a deployment appropriate to your intranet policy.

DPAPI protects secrets at rest but cannot isolate them from arbitrary code running as the same Windows user. General DSH terminal/file tools share that identity. For stronger isolation, constrain those tools and use least-privilege database accounts.

## Persistence and recovery

Configuration lives in `<DSH_HOME>/dsh-db-connect/connections.json` (default `~/.dsh/`). The internal `credential` field stores DPAPI ciphertext on Windows; public APIs strip it. Other platforms keep passwords in memory until plugin unload, with persistent configuration only.

Writes use an exclusive cross-process lock, fsynced temporary file and atomic rename. The previous state is retained as `.bak`. Damaged stores fail closed: they are not silently replaced or restored, because restoring old state can revive revoked grants. Back up the damaged file, stop other writers, and restore manually if appropriate. Remove a stale `write.lock` only after confirming no relevant DSH instances are running. Deleted passwords may still exist as ciphertext in backups; follow your retention policy. A different Windows account/machine must reenter passwords.

## Development and validation

```powershell
node --test tests/*.test.mjs
python -B -m unittest discover -s python -v
# Enable real Node → Python SQLite tests:
$env:DSH_DB_TEST_PYTHON = 'C:\Python312\python.exe'
```

See [validation evidence](docs/validation.md), [architecture and sources](docs/architecture.md), and the more detailed [Chinese guide](README.zh.md).

No arbitrary SQL, pooling, persistent background connections, cross-instance immediate revocation broadcasts, cloud credential vault, Windows integrated authentication, SSH tunneling, or remote service deployment is included in this first release.

MIT. Independently implemented; no DBX source code copied.
