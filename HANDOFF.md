# 接手说明（dsh-db-connect）

> 本文件给在同一工作目录新开 DSH 会话的接手 agent 使用。最后更新：2026-11-17。

## 一句话现状

`dsh-db-connect@0.2.0` **已上架**：GitHub Release v0.2.0 已发布；市场 PR #11031 已于 2026-11-03 17:21 UTC 被维护者 `fkysly` 合并；dsh.so 市场页 https://www.dsh.so/artifact/dsh-db-connect/ 已上线（安装命令 `dsh plugin --profile web add github:stitchmaps/dsh-db-connect#v0.2.0`，风险 Low、Trust Silver、Health Active）。市场页面在 dsh 0.2.2-rc.3 上有一条 L5 运行时验证失败（`plugin active in inventory: rpc-error · entries 0`），已排查为**市场测试环境的清单 RPC 偶发问题**，不是本插件缺陷：本机 DSH 核心同为 0.2.2-rc.3，用临时 profile 安装 0.2.0 后 `apply()` 完整执行成功，且 `dsh-db-connect/client.js` 正常出现在 web 启动模块清单中。0.2.0 新增：字段默认值/注释、`indexes` 动作（主键/唯一与其他索引/外键）。

## 目录

- 插件仓库（独立 git）：`E:\03_Project\Deepseek Harness插件开发\dsh-db-connect`
- 工作区根索引：`E:\03_Project\Deepseek Harness插件开发\README.md`（已含本插件一行）
- 本目录约定：见 `E:\03_Project\Deepseek Harness插件开发\AGENTS.md`

## 已发布

- GitHub：https://github.com/stitchmaps/dsh-db-connect （public；topics: database, deepseek-harness, dsh-plugin, oracle）
- 首提交：`6982c9e feat: release independent database connector v0.1.0`
- Release v0.1.0：https://github.com/stitchmaps/dsh-db-connect/releases/tag/v0.1.0
  - `dsh-db-connect-0.1.0.tgz`（39,394 字节）
  - `SHA256SUMS.txt`：`296b9066f976730d0d2adc9d07c841df65c4389f16e32715d620e1e6369f2c8a`
- Release v0.2.0：https://github.com/stitchmaps/dsh-db-connect/releases/tag/v0.2.0
  - `dsh-db-connect-0.2.0.tgz`（42,850 字节，SHA256 `4ab5be1a32c8ca9e7f2b6039a59ab95cb2b42b750de79fe6b2610c19d3a8e952`）
  - `SHA256SUMS-0.2.0.txt`
- 市场投稿 PR：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11031
  - 状态：**MERGED**（2026-11-03 17:21 UTC，合并人 `fkysly`）；`check` 与 `Submission gate` 均通过
  - yml 条目在 `data/plugins/stitchmaps__dsh-db-connect.yml`（维护者补充了 Python 环境说明）
  - 历史坑：该 PR 分支曾被一次 “sync upstream” 污染成 176 条改动并丢失本插件文件，已通过 GitHub API 重建为「上游 main + 1 个 yml 提交」并 force-push 到 fork 修复；**以后不要对该分支做 sync-upstream**
- 市场页：https://www.dsh.so/artifact/dsh-db-connect/ （安装命令 `dsh plugin --profile web add github:stitchmaps/dsh-db-connect#v0.2.0`）

## 0.2.0 改动（已发布）

- 版本号 `0.2.0`（package.json + 宿主日志 + README/zh）。
- `python/worker.py`：`columns` 增加 `default`、`comment`；新增 `indexes` 动作（主键/索引/外键，SQLite + Oracle + information_schema 通用路径）。
- `lib/service.js`：智能体白名单加入 `indexes`，`indexes` 需要 table。
- `lib/index.js`：`db_inspect` 增加 `indexes` 操作，描述补充 default/comment。
- `lib/client.js`：字段表新增「默认值/备注」列；字段视图下嵌套「索引与键」区块；新增中英文案。
- 测试：Node 26 / Python 21 全通过。

## 市场验证失败排查记录（2026-11-17）

- 现象：dsh.so 页面在 dsh 0.2.2-rc.3 卡片上 `L5.4 Plugin active in inventory` 失败，`verdict rpc-error · entries 0`；同版本 0.2.2-rc.1 / 0.2.1-rc.5 均为 L5 通过。
- 交叉验证：`dsh-better-sidebar`、`dsh-session-bar` 等无关插件同样出现 `verdict rpc-error · entries 0`；是市场测试环境清单 RPC 的偶发/时序问题。
- 本机复现：本机 DSH 核心即 **0.2.2-rc.3**。用临时 `DSH_HOME` + 临时 `web` profile 安装 `dsh-db-connect-0.2.0.tgz`，启动 `dsh web` 后：
  - `dsh-db-connect/client.js` 正常出现在 web 启动模块清单中；
  - 在安装副本的 `apply()` 首尾插入文件标记，两处标记均被写入，证明 `apply()` 完整执行无异常；
  - `--dump-config` 显示 `dsh-db-connect` 已正确装配。
- 结论：插件在 0.2.2-rc.3 上工作正常，市场那条失败不是本插件缺陷；无需发修复版。验证环境已清理，未触碰真实 `DSH_HOME` 业务数据。

## 插件能力（0.2.0 边界，勿夸大）

- 连接管理：Oracle / PostgreSQL / MySQL / MariaDB / SQL Server / SQLite
- Oracle 默认 Thick（oracledb==3.4.2，推荐 Client 19c Basic x64，目标 11.2.0.4）；现代库可用 Thin
- 元数据浏览：schemas / tables / columns（含数据类型、可空、默认值、注释）/ indexes（主键、唯一与其他索引、外键），分页 1–200
- Windows 凭证：DPAPI CurrentUser 加密；其他平台仅进程内
- 每连接独立“允许智能体访问元数据”，默认关闭
- 工具：`db_connections`、`db_inspect`（test/schemas/tables/columns/indexes）
- **不做**：任意 SQL、业务数据行、写库、语义层/Catalog、问数
- 索引/外键取用说明：Oracle 走 all_ind_columns/all_constraints；PG/MySQL/MariaDB 走 information_schema（PG 无标准 indexes 视图，仅返回主键与外键）；SQL Server 目前只返回主键与外键（索引视图未接）；SQLite 走 PRAGMA table_info/index_list/index_info/foreign_key_list。远程索引查询为 mock 测试，未在真实远程库实测。

## 测试与验证证据

- Node：26 项通过、0 跳过（`node --test tests/*.test.mjs`）
- Python：21 项通过（`python -B -m unittest discover -s python -v`）
- 含真实临时 SQLite（列默认值 / 主键 / 唯一 / 外键 / 索引）与 Windows DPAPI；远程驱动与远程索引为 mock
- 证据文件：`docs/validation.md`（需按 0.2.0 更新）
- **未验证**：真实 Oracle 11.2 / 其他远程库连通；远程库 indexes 实际返回；当前 DSH GUI 内安装后的页面行为；离线脚本实际跑通

## 复现测试（本机）

```powershell
$node = 'C:\Users\gary\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\node\bin\node.exe'
$py   = 'C:\Users\gary\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\python\python.exe'
$env:DSH_DB_TEST_PYTHON = $py
& $node --test tests/*.test.mjs
& $py -B -m unittest discover -s python -v
```

## 市场脚本（dist/，不进 git）

- `check-market.mjs`：调用 dsh.so 公开前端校验函数，生成真实 `market-check-report.json`
- `submit-market.mjs`：向 `POST https://www.dsh.so/api/submit` 提交真实报告
- 现状：提交接口连续返回 `429 upstream-rate-limited`，属对方限流
- 约束：不得篡改检查器判定、不得把 findings 置空或 formatPass 硬设 true

## 待办 / 下一步候选

1. 2026-11-02 12:00 后复查 PR 11031 的 Submission gate 是否自动通过；通过后等维护者审核，如实区分“提交”与“已收录”。
2. dsh.so 限流解除后重试一次提交。
3. （未获用户明确要求前不做）把插件装进当前 DSH profile 做实机验收；发布 npm 包。
4. 长期方向（已评估 `dsh-plugin-nlbi`、`@yejiming/dsh-data-agent` 后得出）：
   - 保留本插件作为独立连接底座（DBAPI + oracledb Thick + DPAPI）
   - 率先补“可复用 Host 服务接口 + 完整元数据（注释/主键/外键/索引）”
   - 再做最小 Catalog：快照、差异、AI 释义候选 + 人工确认（inferred/verified/needs_review/retired）
   - 撤销智能体授权后，模型也不得读历史 Catalog
   - Data Agent 原版不能“只改一个配置”接入，需要小范围改 Host 装配与查询执行入口

## 红线

- 不要向用户索取密码、token 或 DSH 凭证
- 不要修改任何既有内部业务仓库，不使用其凭据和数据
- 不要用真实 `DSH_HOME` 业务数据做 UI 验证
- 不要为了热加载重启整个 DSH 桌面进程
