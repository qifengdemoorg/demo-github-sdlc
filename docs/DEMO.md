# GitHub Agentic SDLC 演示剧本

> 仓库：`qifengdemoorg/demo-github-sdlc` · 应用：**TaskFlow**（FastAPI 任务管理 API）
> 总时长：约 30–40 分钟（含 Agent 执行等待，可穿插讲解）

本剧本通过一个真实的功能迭代故事，串联 8 大 GitHub Agentic SDLC 能力：

| 幕 | 能力 | 一句话看点 |
|----|------|-----------|
| 1 | Agentic Workflow | 新 Issue 被 AI 工作流自动分析、打标签、写评论 |
| 2 | Coding Agent | Issue 指派给 Copilot，自动开分支、写代码、提 PR |
| 3 | GitHub Actions | PR 自动触发 Lint + Test 双重检查 |
| 4 | PR Ruleset | 直接 push main 被拒；不过 CI 不给合 |
| 5 | Copilot Code Review | Ruleset 自动请求 Copilot 评审，Agent 响应修复 |
| 6 | Agent Merge | 两个并行 Agent 分支冲突，AI 智能合并 |
| 7 | Agentic Workflow ② | CI 失败后 AI 自动诊断根因并评论（彩蛋） |
| 8 | Agentic Workflow ③ | `/add-tests` 斜杠命令自动补全 PR 测试覆盖（彩蛋） |

---

## 第 0 幕：演示前检查清单（提前 30 分钟）

```bash
# 1. main 分支 CI 是绿的
gh run list --branch main --limit 3

# 2. Ruleset 处于 Active（Settings → Rules → Rulesets → "Protect main"）
gh api repos/qifengdemoorg/demo-github-sdlc/rulesets --jq '.[].name'

# 3. Agentic workflows 已启用
gh aw status

# 4. 标签齐全
gh label list

# 5. 没有遗留的演示 PR / Issue（如有，先跑文末的清理脚本）
gh pr list; gh issue list

# 6. （可选）确认 Demo Doc Updater 定时任务已注册（每周一自动同步剧本）
gh workflow list | grep demo-doc-updater
```

前置条件：
- 组织已启用 **Copilot Coding Agent** 与 **Copilot Code Review**（Business/Enterprise）
- 仓库 Actions 已启用；Agentic Workflow 使用 Copilot 引擎（`copilot-requests: write`）
- 演示者对仓库有 admin 权限

---

## 第 1 幕：Issue 触发 Agentic Workflow（约 4 分钟）

**讲解点**：Agentic Workflow = 用自然语言 Markdown 写的 AI 工作流，编译后跑在
GitHub Actions 里，默认只读 + safe-outputs 白名单写入，安全可控。

> 预置的 Issue #1（priority）和 #2（due date）已被自动 triage 过，可先展示它们的
> 标签和 AI 评论作为"结果"，再现场创建一个新 Issue 看"过程"。

1. 先给观众看源文件 `.github/workflows/issue-triage.md`——"这不是 YAML，是给 AI 的自然语言指令"。
2. 现场创建一个**bug 类** Issue（与预置的 enhancement 形成分类对比）：

```bash
gh issue create \
  --title "DELETE /tasks/{id} returns 500 when id is not a number" \
  --body "Sending DELETE /tasks/abc returns an unhandled error instead of a clean 4xx.

Steps to reproduce:
1. Start the server
2. curl -X DELETE http://localhost:8000/tasks/abc
3. Observe the response

Expected: 422 validation error. Actual: unhandled exception."
```

3. 打开 **Actions** 标签页 → `Issue Triage` 正在运行（约 1–2 分钟）。
4. 回到 Issue：出现 `enhancement` + `priority:medium` 标签和一条 AI 分析评论
   （包含影响文件、实现提示——这条提示还能帮到第 2 幕的 Coding Agent）。

> 🧯 兜底：若工作流排队慢，切到事先准备好的另一个已被 triage 的 Issue 展示效果，
> 继续下一幕，跑完再回看。

---

## 第 2 幕：指派给 Coding Agent（约 5 分钟，Agent 后台跑 10–15 分钟）

**讲解点**：Coding Agent 是"云端结对程序员"——领任务、开分支、写代码写测试、提 Draft PR，
全程在受控的 Actions 环境中执行，产出必须走 PR 评审。

1. 在 **Issue #1（Support task priority levels）** 页面右侧 **Assignees** 中选择
   **Copilot**（或用命令行）：

```bash
# 方式一：网页 UI 指派 Copilot（推荐，观众直观）
# 方式二：命令行
gh agent-task create --repo qifengdemoorg/demo-github-sdlc \
  "Implement issue #1: add priority field to tasks per acceptance criteria"
```

> 💡 提示：想给第 6 幕省时间，可以**现在就把 Issue #2（due dates）也指派给 Copilot**，
> 让两个 Agent 并行开发。

2. Issue 上出现 👀 反应 → Copilot 创建 Draft PR（标题类似 *Add priority support to tasks*）。
3. 点开 PR 里的 **View session**，展示 Agent 的实时工作日志：读 `copilot-instructions.md`、
   改 `app/models.py`、`app/main.py`、补 `tests/`、本地跑 pytest。
4. **不用等它跑完**——讲解 `.github/copilot-instructions.md` 如何约束 Agent 的编码规范，
   然后进入第 4 幕（Ruleset），回头再看结果。

> 🧯 兜底：预置分支 `fallback/priority` 已包含同款完整实现（14 个测试全绿），
> Agent 卡住时一键开 PR 展示：`gh pr create --head fallback/priority --fill`

---

## 第 3 幕：GitHub Actions 自动检查（约 2 分钟）

**讲解点**：AI 写的代码和人写的代码走同一套质量门禁。

Coding Agent 的 PR 一提交，`CI` workflow 自动运行：

```bash
gh pr checks <PR号> --watch
```

- **Lint**（ruff）+ **Test**（pytest）两个 job
- 给观众看 PR 页面的 Checks 区域全绿

---

## 第 4 幕：PR Ruleset 强制门禁（约 3 分钟）

**讲解点**：Ruleset 是平台级的“规则即代码”——无论人还是 AI，都绕不过去。

现场演示直接 push main 被拒：

```bash
git checkout main && git pull
echo "# hotfix" >> README.md
git commit -am "hotfix: sneak into main"
git push origin main
# ❌ 被拒绝：GH013: Repository rule violations found
#    - Changes must be made through a pull request.
git reset --hard origin/main   # 现场还原
```

再打开 **Settings → Rules → Rulesets → Protect main** 展示三条规则：
1. 必须通过 Pull Request 修改 main
2. 必须通过 `Lint` 和 `Test` 两个状态检查
3. 自动请求 Copilot Code Review（第 5 幕的伏笔）

---

## 第 5 幕：Copilot Code Review（约 5 分钟）

**讲解点**：AI 评审不是可选插件，而是 Ruleset 强制的流程环节；AI 写码 + AI 评审 + 人类终审 = 分层防御。

1. 回到第 2 幕的 PR：因为 Ruleset 的 *Automatically request Copilot code review* 规则，
   **Copilot 已自动出现在 Reviewers 里**并留下了评审意见（typically 2–5 条：
   校验缺失、边界条件、测试盲区等）。
2. 挑一条评审意见展示，然后让 Coding Agent 响应——在 PR 评论区：

```text
@copilot Address the review comments from Copilot code review.
```

3. Agent 新起一次会话推送修复 commit → CI 重新跑绿 → 人类（演示者）点 **Approve** 并
   **Ready for review** → 合并 PR #1。

```bash
gh pr merge <PR号> --squash --delete-branch
# 若演示时间紧张，演示者(admin)可用 --admin 立即合并（Ruleset 的 PR-only bypass）
```

> 🧯 兜底：若自动评审迟迟未出现，手动请求一次（效果相同，已验证可用）：
> ```bash
> gh api -X POST repos/qifengdemoorg/demo-github-sdlc/pulls/<PR号>/requested_reviewers \
>   -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
> ```
> 若 Copilot Review 没有可展示的评论（代码太完美），切到预置的
> **PR #6（fallback/review-demo）**——它埋了绕过校验、路由顺序 bug、缺测试三类缺陷，
> Copilot 的评审意见已经在上面了。

---

## 第 6 幕：Agent Merge —— 并行 Agent 的冲突合并（约 8 分钟）

**讲解点**：真实团队里多个 Agent 并行开发是常态，冲突不可避免。
Agent Merge 用 AI 理解**两边的意图**做语义级合并，而不是逐行文本合并。

**准备**（若第 2 幕已并行指派则跳过）：把 **Issue #2（Add due dates with overdue
tracking）** 也指派给 Copilot。两个功能都会改 `app/models.py` 的 `Task` 模型和
`app/main.py` 的路由 → **天然冲突**。

1. 此时 PR #1（priority）已合入 main，PR #2（due_date）显示 **conflicts with main**。
2. 演示 Agent Merge —— 两条路线任选：

**路线 A（Copilot CLI / Agents 面板，推荐）**：本地用 Copilot CLI 的 agent merge 能力，
把两个 agent 分支（或 PR #2 与最新 main）智能合并：

```bash
git fetch origin
# 在 Copilot CLI 中: 让 agent 将 due_date 分支与 main（含 priority）合并，
# 提示词示例：
#   "Merge branch 'copilot/due-date' with main. Both modified the Task model.
#    Keep BOTH features: priority and due_date. Ensure all tests pass."
```

AI 会同时保留两个字段、合并 `?priority=` 与 `?overdue=` 查询参数、融合两组测试——
这是文本 diff 工具做不到的。

**路线 B（纯 GitHub 网页流）**：直接在 PR #2 评论：

```text
@copilot Resolve the merge conflicts with main. Keep both the priority and
due_date features intact, and make sure the combined test suite passes.
```

Coding Agent 会 rebase / merge 并推送解决冲突的 commit。

3. 冲突解决后：CI 绿 → Copilot Review 通过 → 合并 PR #2。
4. 收尾展示 main 上的最终代码：`Task` 同时拥有 `priority` 和 `due_date`，
   测试从 8 个涨到 20+ 个，全绿。

> 🧯 兜底：预置分支 `fallback/merged` 包含两个功能的手工合并结果（20 个测试全绿），
> 可直接展示最终形态。

---

## 第 7 幕（彩蛋）：CI Doctor 自动诊断失败（约 4 分钟）

**讲解点**：Agentic Workflow 不只处理“正常流”，还能兜住“异常流”——CI 红了，AI 先到现场。

1. 提一个带 bug 的 PR：

```bash
git checkout -b demo/broken-test origin/main
# 制造一个 bug：把创建接口的状态码改错
sed -i '' 's/status_code=201/status_code=200/' app/main.py
git commit -am "refactor: simplify create endpoint response"
git push -u origin demo/broken-test
gh pr create --fill
```

2. CI 的 **Test** job 失败 → 触发 `CI Doctor` agentic workflow。
3. 约 2 分钟后 PR 上出现诊断评论：**失败的 job/step、根因（引用日志）、修复建议**，
   落款 `🩺 Automated diagnosis by CI Doctor (agentic workflow)`。
4. 讲解 `ci-doctor.md` 源文件 30 秒，收尾。

---

## 第 8 幕（彩蛋）：Test Writer —— 斜杠命令补全测试（约 3 分钟）

**讲解点**：Agentic Workflow 不仅能响应事件，还能响应斜杠命令（slash command）——
任何有权限的协作者在 PR 评论里输入 `/add-tests`，AI 就会自动分析覆盖缺口、补写测试、推送 commit。

1. 打开第 2 幕 Coding Agent 提的任意一个 PR（或新建一个带改动但测试不完整的 PR）。
2. 在 PR 评论框输入：

```text
/add-tests
```

3. 打开 **Actions** 标签页 → `Test Writer` workflow 正在运行（约 1–2 分钟）。
4. 工作流完成后：
   - PR 分支上新增一个 `test: add missing coverage via /add-tests` commit；
   - PR 评论区出现 AI 摘要：覆盖缺口、新增用例列表、ruff/pytest 结果，
     落款 `🧪 Automated tests by Test Writer (agentic workflow)`。
5. 展示 `.github/workflows/test-writer.md` 源文件——"同样是自然语言指令，30 行定义一个斜杠命令"。

> 💡 与第 1 幕（Issue Triage）对比：都是 Agentic Workflow，触发器不同——
> 前者响应 `issues.opened` 事件，后者响应 `pull_request_comment` 上的 `/add-tests` 命令。

> 🧯 兜底：若 Test Writer 排队较慢，先展示 `test-writer.md` 源文件讲解机制，
> 再回头看 workflow run 结果。

---

## 演示后清理

```bash
# 关闭演示 PR 与 Issue、删除演示分支（保留 fallback/* 与 PR #6、Issue #1/#2）
git push origin --delete demo/broken-test 2>/dev/null || true

# 如需完全重置代码到基线（谨慎！需临时停用 Ruleset）：
# gh api -X PUT repos/qifengdemoorg/demo-github-sdlc/rulesets/<id> -f enforcement=disabled
# git push origin <baseline-sha>:main --force
# 然后重新启用 Ruleset
```

## 常见问题（Q&A 弹药）

- **Agent 写的代码谁负责？** PR 作者是 Copilot，但合并需要人类 Approve——责任模型不变。
- **Agentic Workflow 会不会乱写？** 主 job 只读，所有写操作走 safe-outputs 白名单
  （本仓库只允许加标签、发评论），且有网络隔离与工具白名单。
- **成本？** Coding Agent 按 premium request 计费；Agentic Workflow 消耗 Actions 分钟数
  + Copilot 请求。
- **为什么不用一个 Agent 串行做两个功能？** 并行是吞吐量优势；Agent Merge 解决并行的
  代价（冲突），两者配合才能规模化。
- **剧本本身如何保持最新？** 仓库内置 `demo-doc-updater` Agentic Workflow，每周一自动扫描
  新合并的 PR 与 Issue，更新本文件并提 PR，无需人工维护。
