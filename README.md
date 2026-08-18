# TaskFlow — GitHub Agentic SDLC Demo

一个用于演示 **GitHub Agentic SDLC** 的示例仓库：以最小的 FastAPI 任务管理 API（TaskFlow）
为载体，完整串联 AI 驱动的软件研发生命周期。

## 覆盖的能力

| # | 能力 | 载体 |
|---|------|------|
| 1 | **Coding Agent** | 将 Issue 指派给 Copilot，自动开发并提交 PR |
| 2 | **Agentic Workflow** | `issue-triage`（自动分类 Issue）与 bug / enhancement 双链路自动派发，基于 [gh-aw](https://github.com/github/gh-aw) |
| 3 | **GitHub Actions** | `ci.yml`：ruff Lint + pytest Test |
| 4 | **PR Ruleset** | main 分支强制 PR、强制状态检查 |
| 5 | **Copilot Code Review** | Ruleset 自动请求 Copilot 评审每个 PR |
| 6 | **Agent Merge** | 并行 Agent 分支的 AI 语义级冲突合并 |
| 7 | **Agentic 规划链路** | Issue 打 `enhancement` 标签后，`plan-dispatcher` → `plan-writer` 自动产出实现计划评论 |

👉 **完整演示剧本见 [docs/DEMO.md](docs/DEMO.md)**（9 幕，含命令、预期效果与兜底方案）。

## TaskFlow 应用

极简任务管理 API（内存存储，无外部依赖）：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 简单 Web UI（任务管理界面） |
| GET | `/health` | 健康检查 |
| GET | `/tasks` | 任务列表 |
| POST | `/tasks` | 创建任务 |
| GET | `/tasks/{id}` | 任务详情 |
| PATCH | `/tasks/{id}` | 更新任务 |
| DELETE | `/tasks/{id}` | 删除任务 |

> `Task` 模型当前只有 `title` / `done` —— **优先级、截止日期等扩展被刻意留作 Issue**，
> 作为演示中 Coding Agent 的开发素材。

访问根路径 `/` 即可打开一个零依赖的静态页面（`app/static/index.html`），
支持添加、勾选完成、删除任务，全部通过上述 API 完成。

## 本地开发

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

pytest            # 运行测试
ruff check .      # 代码检查
uvicorn app.main:app --reload   # 启动服务 → http://127.0.0.1:8000/ (UI) 或 /docs (API)
```

## 仓库结构

```
app/                    # FastAPI 应用（main.py 路由，models.py 模型）
app/static/             # 简单 Web UI（index.html）
tests/                  # pytest 测试
.github/workflows/
  ci.yml                # GitHub Actions CI
  issue-triage.md       # Agentic workflow 源文件（自然语言）
  issue-triage.lock.yml # gh aw compile 产物
  fix-dispatcher.md → bug-fixer.md      # bug 链路：判定 → 改代码开 PR
  plan-dispatcher.md → plan-writer.md   # enhancement 链路：判定 → 出实现计划
.github/agents/         # 可复用的 agent 指令，workflow 用 imports: 引入
  taskflow-bug-fixer.md # 修复纪律与领域知识
  taskflow-planner.md   # 规划纪律与计划模板
.github/copilot-instructions.md  # Coding Agent / Code Review 自定义指令
docs/DEMO.md            # 演示剧本
```

### Agentic 工作流链路

```text
issue-triage ──label: bug─────────> fix-dispatcher  ──dispatch──> bug-fixer   （改代码，开 PR）
issue-triage ──label: enhancement─> plan-dispatcher ──dispatch──> plan-writer （只读，出计划）
```

两条链路同构：前一段是**判定门**（三态 PLAN/DECLINE/UNSURE，存疑即拒），后一段是**执行者**。
Plan Writer 全程只读——不给 `edit` 工具、不产出 PR，唯一的写操作是一条计划评论加一个
`plan:ready` / `plan:declined` 标签。
