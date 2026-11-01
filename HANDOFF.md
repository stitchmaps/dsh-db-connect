# 接手说明（dsh-db-connect）

> 本文件给在同一工作目录新开 DSH 会话的接手 agent 使用。最后更新：2026-11-01。

## 一句话现状

`dsh-db-connect@0.1.0` 已完成开发、测试、打包，已推送 GitHub 并发布 Release；社区插件市场投稿 PR 已提交，唯一未通过项是仓库年龄门槛（满 1 天自动清除）。npm 未登录，未发布 npm 包。

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
- 市场投稿 PR：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11031
  - 分支 `stitchmaps:add-dsh-db-connect-20261101`，只新增 `data/plugins/stitchmaps__dsh-db-connect.yml`
  - 状态：OPEN / MERGEABLE；基础 check 通过；**Submission gate 失败，唯一原因“repository is 0.0 days old (needs 1)”**
  - 官方说明：该 gate 自动重跑，约 24h 后自动清除，**不要重推、不要关重开、不要重提交**

## 插件能力（0.1.0 边界，勿夸大）

- 连接管理：Oracle / PostgreSQL / MySQL / MariaDB / SQL Server / SQLite
- Oracle 默认 Thick（oracledb==3.4.2，推荐 Client 19c Basic x64，目标 11.2.0.4）；现代库可用 Thin
- 元数据浏览：schemas / tables / columns，分页 1–200
- Windows 凭证：DPAPI CurrentUser 加密；其他平台仅进程内
- 每连接独立“允许智能体访问元数据”，默认关闭
- 工具：`db_connections`、`db_inspect`（test/schemas/tables/columns）
- **不做**：任意 SQL、业务数据行、写库、语义层/Catalog、问数

## 测试与验证证据

- Node：24 项通过、0 跳过（`node --test tests/*.test.mjs`）
- Python：18 项通过（`python -B -m unittest discover -s python -v`）
- 含真实临时 SQLite 与 Windows DPAPI；远程驱动为 mock
- 证据文件：`docs/validation.md`
- **未验证**：真实 Oracle 11.2 / 其他远程库连通；当前 DSH GUI 内安装后的页面行为；离线脚本实际跑通

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
- 不要修改 `HZsql` / `SQLBot` / `hz-workbench` 业务仓库，不使用其凭据和数据
- 不要用真实 `DSH_HOME` 业务数据做 UI 验证
- 不要为了热加载重启整个 DSH 桌面进程
