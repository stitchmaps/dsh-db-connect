# 验证记录 — 0.2.0

验证日期：2026-11-01（本机，临时合成数据）。相对 0.1.0：新增字段默认值/注释与 `indexes`（主键/索引/外键）能力。

## 0.2.0 新增项

- Node 自动化测试：**26 项通过，0 跳过**（新增：智能体仅对已启用连接请求 `indexes`；真实 SQLite 端到端校验字段默认值与索引/外键）。
- Python unittest：**21 项通过**（新增：SQLite 字段默认值、主键/唯一/外键/索引；PostgreSQL 与 Oracle 远程 `indexes` mock）。
- Client VM 契约新增：字段视图挂载「索引与键」区块，渲染不崩溃。
- 所有 `lib/*.js` 的 `node --check` 通过。

## 0.2.0 未验证与边界

- 远程库 `indexes` 仅在 mock 下验证；未连真实 Oracle/PostgreSQL/MySQL/SQL Server 实测索引与外键返回。
- PostgreSQL 无标准 `information_schema.indexes` 视图，当前仅返回主键与外键；SQL Server 同样只返回主键与外键（未接索引视图）。
- 注释：Oracle 取 `all_col_comments`；SQLite 无注释概念恒为 null；通用 information_schema 路径当前不取注释（留 null）。

---

# 验证记录 — 0.1.0

验证日期：2026-10-31。使用 Windows 本机及临时合成数据；不读取或连接现有业务项目数据库。

发布复验：2026-11-01，重新执行 Node 24 项测试（0 跳过）与 Python 18 项测试，全部通过，包含真实临时 SQLite 和 Windows DPAPI 往返。下方真实 DSH 工具契约记录来自 2026-10-31，本次复验没有新增 GUI 或远程数据库实测。

## 已执行

- Node 自动化测试：**24 项通过，0 跳过**。
  - 配置白名单、敏感字段不公开、默认关闭模型访问。
  - 修改目标需重新输入密码，修订冲突阻止旧页面覆盖。
  - 原子保存、备份、跨实例锁及损坏文件保护。
  - 撤销授权后的旧快照/在途请求不会返回结果，旧快照不会启动 worker。
  - 被替换/删除的会话内口令清理、提交失败清理。
  - 精确保留带空格的 schema/table 标识符。
  - **真实 Node → Python → SQLite**：创建临时测试库后读取模式/字段、测试连接及驱动诊断。
  - **真实 Windows DPAPI**：中文和特殊字符密码的加解密往返。
  - 工作进程超时、强制取消、输出上限、等 close 后释放容量、退出竞态与 dispose。
  - Client VM 契约：main/sidebar 槽位、本地化键一致、六类表单、密码不回填、运行时边界。
- Python 标准库 unittest：**18 项通过**。
  - 真实临时 SQLite：只读、不创建不存在文件、特殊标识符和分页。
  - Oracle/PostgreSQL/MySQL/MariaDB/SQL Server：mock 验证驱动参数、绑定参数、分页、TLS、超时及清理。
  - Oracle 默认 Thick、Thin SID、客户端版本检查。
  - MySQL 在认证前拒绝 TLS 静默降级。
  - 子进程协议、输入上限和固定错误脱敏。
- 所有 `lib/*.js` 的 `node --check` 通过。
- 三个 PowerShell 脚本的 AST 语法解析通过。
- 使用安装版 DSH `0.2.1-rc.3` 的真实 `defineTool` 验证 `db_connections` / `db_inspect` 并执行 mock 工具调用：通过。
  - 以 `ELECTRON_RUN_AS_NODE=1` 运行隔离脚本，只读载入已安装包。
  - 未启动、重启或修改当前 DSH profile。

## 未验证与交付边界

- **未连接真实 Oracle 11.2 或其他远程数据库**。驱动 mock 测试不等于网络连通、服务器版本兼容或账号权限验证。
- 未在当前 DSH GUI 安装本插件，因此未验证真实页面布局、交互、插件卸载或宿主热加载；客户端只做语法和 VM 契约检查。
- 未下载第三方 wheel/native client，未实际执行离线安装脚本。脚本通过语法校验，需在目标平台准备和验证依赖包。
- 未将当前业务数据、账号、口令、Oracle 脱敏样本或旧项目资产打入插件。
- Python 导入诊断不触发 Oracle Client 初始化，不应当作 OCI 加载成功的证据。

## 内网验收建议

1. 记录 OS/Python/位数、Oracle Client、python-oracledb、数据库完整补丁版本。
2. 先运行驱动诊断，再使用专用最小权限账号测试连接。
3. 核对 Service/SID、模式、表与字段分页，以及中文对象名。
4. 测试错误口令、不可达主机、超时；确认提示不泄露口令。
5. 重启 DSH 后确认配置和 Windows 密码可用；异机需重新输入密码。
6. 默认智能体连接列表应为空，开启一个连接后只出现该连接；关闭后不可再浏览。
7. 在空白测试 profile 中确认 UI 与卸载行为，不以真实业务状态灌入测试数据。

## 可重复命令

```powershell
$env:DSH_DB_TEST_PYTHON = 'C:\Python312\python.exe'
node --test tests/host.test.mjs tests/runner-lifecycle.test.mjs tests/client.test.mjs
python -B -m unittest discover -s python -v

# 安装版 DSH 工具契约（可选；在独立 shell 内运行）
$env:ELECTRON_RUN_AS_NODE = '1'
$env:DSH_APP_ROOT = 'C:\path\to\DSH NEXT\resources\app.asar'
& 'C:\path\to\DSH NEXT\DSH NEXT.exe' tests/dsh-contract.cjs
```
