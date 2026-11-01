# 架构与参考资料

## 模块边界

```text
DSH Client 页面 ─┐
                ├─ DatabaseService ─ Store / Vault / ProcessRunner
DSH 两个工具 ───┘                                 │
                                                  └─ Python worker → 各数据库驱动
```

- `lib/index.js`：当前 DSH Fetch route 与 defineTool；不注册 SQL 工具。
- `lib/service.js`：连接版本、用户/模型能力边界、修改后撤销在途请求、精确元数据标识符。
- `lib/store.js`：文件白名单校验、原子写、独占锁、上一版备份；损坏时拒绝自动恢复授权。
- `lib/vault.js` + `scripts/credential.ps1`：Windows DPAPI；其他 OS 暂用仅内存凭据。
- `lib/runner.js`：无 shell 的 stdin JSON 工作进程、2 MiB 输出上限、最多四进程；终止后等待 close 才释放容量。
- `python/worker.py`：一次调用一个进程，惰性驱动导入，参数化元数据查询；Oracle 使用 11g 可用的 ROWNUM 分页。
- `lib/client.js`：DSH main / sidebar.panellist 槽位、locale 服务和主题变量；组件卸载取消请求，切换目标丢弃旧响应。

第一版选择一次操作一个 worker，牺牲一些连接延迟换取 OCI 进程级初始化隔离、可靠取消和较小生命周期复杂度。后续如需连接池，可保持应用服务接口并替换运行时；不应改变用户凭据授权边界。

同一 Host 内的保存/删除/撤权，在成功提交后提升请求代数并取消当前连接的在途任务；旧请求在解密后、启动前检查配置版本，结果返回前再次检查。多个独立 Host 实例只通过持久版本和写锁协调，尚无跨进程即时撤权广播。

## DBX 参考

研究对象为 [t8y2/dbx](https://github.com/t8y2/dbx)，不是名称相似的其他项目。

DBX 是 Vue/TypeScript + Tauri/Rust 的完整数据库客户端；共享 core、drivers、SQL、MCP 等模块。这里只借鉴驱动分层和工作进程隔离，没有复制它的代码或资源，因此本仓库原始代码使用 MIT。DBX 本身使用 Apache-2.0，未来复用其代码必须保留相应许可和通知。

参考源：

- [DBX 前端 manifest](https://raw.githubusercontent.com/t8y2/dbx/main/package.json)
- [DBX Tauri manifest](https://raw.githubusercontent.com/t8y2/dbx/main/src-tauri/Cargo.toml)
- [DBX drivers manifest](https://raw.githubusercontent.com/t8y2/dbx/main/crates/dbx-drivers/Cargo.toml)
- [DBX LICENSE](https://raw.githubusercontent.com/t8y2/dbx/main/LICENSE)

## 驱动官方文档

- [python-oracledb 安装、Thin/Thick 和互操作矩阵](https://python-oracledb.readthedocs.io/en/latest/user_guide/installation.html)
- [Oracle 客户端初始化](https://python-oracledb.readthedocs.io/en/latest/user_guide/initialization.html)
- [Oracle 精确客户端/服务器认证矩阵 207303.1](https://support.oracle.com/knowledge/Oracle%20Database%20Products/207303_1.html)（完整内容需要 Oracle Support 登录）
- [Oracle 离线安装](https://python-oracledb.readthedocs.io/en/latest/user_guide/installation.html#installing-python-oracledb-without-internet-access)
- [psycopg 3 安装](https://www.psycopg.org/psycopg3/docs/basic/install.html)
- [PyMySQL 安装与认证依赖](https://pymysql.readthedocs.io/en/latest/user/installation.html)
- [pyodbc](https://github.com/mkleehammer/pyodbc)
- [Microsoft ODBC Driver](https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server)
- [Python SQLite URI 连接](https://docs.python.org/3/library/sqlite3.html)

## DSH 接口依据

本会话使用 Cordis Inspect 核对 tools、connection、credentials、locale 服务，以及 main/sidebar.panellist 槽位和主题 token。DSH 默认 credentials-local 是同用户可读的本地文件服务，不承诺 DPAPI 加密，因此本插件单独提供 Windows 加密适配，没有误把默认凭据服务当作系统密钥库。

UI 和 Host 均不依赖旧桌面的 `window.hzShell`，不改宿主 DOM，不重写 DSH 外壳，不读取旧业务项目配置。安装使用插件管理器；旧目录指南中的手工 profile 修改方式不用于此包。
