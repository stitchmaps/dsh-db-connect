# DSH 数据库连接插件

[English](README.md) | 中文


## 当前范围

- Oracle、PostgreSQL、MySQL、MariaDB、SQL Server、SQLite。
- Oracle 默认 Thick 模式，支持 Service Name / SID 和独立客户端目录；现代库也可选择 Thin。
- Windows 密码使用当前用户 DPAPI 加密，密码不回显、不出现在工具参数和返回值、不放入命令行。
- 每个连接单独开启「允许智能体访问元数据」，默认关闭。
- 分页元数据、并发上限、超时强制终止、取消和插件卸载清理。
- 字段明细（数据类型、可空、默认值、备注）与键结构视图（主键、唯一/其他索引、外键）。
- 中文/英文界面、DSH 主题适配。

**0.2.0 只提供连接和元数据能力，不执行用户 SQL，不读取业务数据行，不写库，不含语义层或交管业务。** Redis、MongoDB、达梦等尚未实现；没有把兼容协议当成已经验证的支持。

## 环境与安装

目标 DSH API 基线：`0.2.1-rc.3`；清单允许 `>=0.2.1-rc.3 <0.3.0`，其他版本未逐一实测。旧桌面锁定的 DSH `0.1.6` 不兼容本插件。

1. 从 [GitHub Releases](https://github.com/stitchmaps/dsh-db-connect/releases) 下载 `dsh-db-connect-0.2.0.tgz`，或克隆本仓库。使用当前 DSH 的插件管理器安装压缩包或仓库目录，在本地包安装入口填写绝对路径。不要同时手工追加 profile 的 insert 行。
2. 准备独立 Python 环境。推荐 Windows x64 Python 3.12；SQLite 只需要 Python 标准库。其他数据库安装 `python/requirements.txt` 中的可选驱动。
3. 打开左侧「数据库」→「运行环境」，填写该环境 `python.exe` 的绝对路径，执行「检查环境」。留空时使用 `DSH_DB_PYTHON`，再回退到 PATH 中的 Python；不会自动寻找或依赖 DSH 私有打包路径。
4. 新建连接、保存，然后测试连接。保存配置不会自动联系数据库。
5. 切到「数据结构」浏览元数据。如需智能体使用，显式开启该连接的元数据访问。

**更改 Python 路径会清除现有连接的凭据和智能体授权。** 这样新解释器不会自动接收到旧密码；设置好解释器后再录入连接最方便。Oracle 客户端目录、目标地址、账号、数据库、连接模式或 TLS 设置变化时，也不能无密码地沿用旧凭据。

插件源码没有 Node 第三方运行时下载需求；`@deepseek-ai/dsh-tools` 使用宿主提供的 peer 包。启动时不会执行 pip/npm 安装，不访问公网。

## 数据库支持矩阵

| 类型 | Python 驱动 | 额外要求与限制 |
|---|---|---|
| Oracle 11.2 | `oracledb==3.4.2`，Thick | 推荐 Oracle Instant Client **19c Basic x64**，匹配 Python 位数及 VC 运行库；确认服务名或 SID、数据库补丁 |
| Oracle 12.1+ | 同上，Thin 或 Thick | Thin 无需 OCI；Thin 不是 Oracle 11g 的兼容方案 |
| PostgreSQL | `psycopg[binary]` 3.x | 默认 TLS `verify-full`，内网自签 CA 须配置受信任证书 |
| MySQL / MariaDB | `PyMySQL[rsa]` 1.x | 默认校验证书，拒绝服务器不支持 TLS 时偷偷降级；RSA 依赖支持相应认证方式 |
| SQL Server | `pyodbc` 5.x | 另装 Microsoft ODBC Driver 18；元数据分页使用 SQL Server 2012+ 语法，当前仅账号密码认证 |
| SQLite | 标准库 `sqlite3` | 只打开已有绝对路径文件，`mode=ro` + `query_only`；不创建库，不加载扩展 |

Oracle 需要特别说明：

- 官方公开文档概括 Client 19 支持 DB 11.2+，精确组合以 Oracle 支持矩阵及目标库补丁为准。推荐以 11.2.0.4 为验证目标，不能无条件宣称所有 11.2 补丁都兼容，也不能把 .4 当作所有组合的唯一最低版本。
- 为保证调用超时，本插件的 Thick 路径要求 Oracle Client 18+；连接 11.2 时推荐 **19**，不要换成仅面向更高数据库版本的 Client 21/23。
- 固定 python-oracledb 3.4.2 是为保留其包含 11.2 的历史测试范围；这不是本插件已经实测内网数据库的证明。
- 当前 Oracle 连接是 TCP Service/SID；尚未实现 TCPS wallet、TNS alias、Kerberos 或 SSH 隧道。TLS 下拉项仅用于其余远程 SQL 数据库。
- 旧库中文字符集优先选择 Basic 而非 Basic Light。新旧 OCI 不在同一进程混用：每个操作启动独立 worker。

## 内网离线部署

联网准备机与内网机使用相同 OS、CPU 位数和 Python 主次版本。

```powershell
# 联网准备机：只下载 wheels 及哈希清单，不安装到 DSH
.\scripts\prepare-offline.ps1 -PythonExe 'C:\Python312\python.exe' -Wheelhouse 'D:\transfer\db-wheels'

# 将完整插件包、wheelhouse、Python 安装程序及原生客户端安装程序带入内网。
# 内网机：验证每个文件哈希，创建一个新的独立虚拟环境，仅从本地安装
.\scripts\setup-runtime.ps1 -PythonExe 'C:\Python312\python.exe' -Wheelhouse 'D:\transfer\db-wheels' -Venv 'D:\apps\dsh-db-python'
```

脚本生成包含所有下载文件 SHA-256 和构建环境信息的 `manifest.json`。安装拒绝清单外文件、哈希不符和平台/Python 版本不符；使用 `pip --no-index`。这份清单提供传输完整性，**不是签名认证**，应从可信渠道搬运。范围依赖在准备时解析，完整 wheelhouse 冻结本次解析结果；安装后输出 `installed-requirements.txt` 留档。Oracle 客户端、VC 运行库、SQL Server ODBC 驱动和 Python 安装程序需按各自许可证单独准备，未随此插件分发。

也可只安装所需驱动。SQLite 验证无需 pip。企业 CA 可使用驱动支持的系统信任或 PostgreSQL CA 配置；不要为方便默认禁用 TLS。运行时诊断只证明模块可导入，不证明 OCI 可加载或数据库可达。

## 智能体接口

- `db_connections`：只列出用户启用的连接 ID、名称、类型和修订号。
- `db_inspect`：`test / schemas / tables / columns / indexes`；默认 100 项，最多 200 项，使用 `hasMore + offset` 翻页。`columns` 返回数据类型、可空、默认值与备注；`indexes` 返回单表的主键、索引与外键结构。

模型不能通过这些工具创建连接、改凭据、开启授权或修改 Python 路径。数据库名称、表名等是外部数据，不是模型指令。只在信任的 DSH 实例和网络边界下使用；启用元数据访问后，名称会进入模型上下文，应匹配你的内网模型与组织规定。

DSH 的通用终端和文件工具与当前 OS 用户同权。DPAPI 防止口令以明文落盘，**不能隔离同一用户下可执行代码的智能体**。若需要强隔离，应另行约束 DSH 工具权限和数据库账户；使用专用最小权限账户。

## 数据保存与恢复

- 配置：`<DSH_HOME>/dsh-db-connect/connections.json`，默认 `~/.dsh/dsh-db-connect/`。
- Windows 凭据密文在连接记录的 `credential` 字段；公开 API 会剔除它。
- 主文件采用同目录临时文件、fsync、原子替换；上次版本保留为 `.bak`。
- 文件损坏时停止读取/保存，**不自动恢复旧授权**。确认没有其他实例写入后，备份损坏文件，再人工恢复 `.bak`。
- 保存使用跨进程独占 `write.lock`；异常退出遗留时，仅在确认所有相关 DSH 实例停止后删除锁。
- 删除连接或更改解释器会清除活动记录的凭据；历史 `.bak` 可能仍包含旧密文。彻底清除需按组织保留策略处理备份。
- DPAPI 密文绑定 Windows 用户；迁机后重新输入密码。其他平台仅在当前插件运行期间保存密码，重载后需重填；配置仍持久化。Windows 是主要交付平台。

## 开发与验证

```powershell
node --test tests/*.test.mjs
python -B -m unittest discover -s python -v
# 要运行 Node→Python 的真实 SQLite 集成测试，先设：
$env:DSH_DB_TEST_PYTHON = 'C:\Python312\python.exe'
```

见 [验证记录](docs/validation.md) 和 [架构及参考资料](docs/architecture.md)。所有测试使用临时合成数据，未使用业务项目的数据库、密码、样本或配置。

本版未提供任意 SQL、连接池、后台保活、多实例即时撤权广播、云凭据库、Windows 集成认证、私有 CA 文件编辑器或远程部署服务。它是独立连接与元数据基础插件，后续语义层可以在此边界上扩展。

MIT。独立实现；没有复制 DBX 源码。
