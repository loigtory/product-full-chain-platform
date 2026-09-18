---
name: rdc-code-review
description: Automated code review(代码审查) for frontend, backend (Java), and database (MySQL) projects before git commit or merge. Detects security vulnerabilities, logic bugs, coding standard violations, and database design/SQL issues. Use when reviewing code changes, performing pre-commit checks, pre-merge quality gates, or when asked to review code quality. Supports standalone execution and integration into CI/development workflows. Outputs structured results suitable for automated commit/push blocking decisions.
metadata:
  name-zh: "代码审查"
  category: "git-workflow"
  version: "1.0.1"
  author: "肖佩武"
  email: "hz1203310@huize.com"
  department: "研发中心"
  priority: "高"
  dev-status: "published"
---

# Code Review

Pre-commit / pre-merge code review for frontend, backend (Java), and database (MySQL) projects. Detect security vulnerabilities, logic bugs, best-practice violations, and database design/SQL issues in git-controlled code changes.

## Workflow

1. Validate environment and determine review scope
2. Detect project type (frontend / backend-java / database / mixed)
3. Collect changed code with context
4. Apply review rules by project type
5. Output structured results
6. Optionally save report to markdown

## Parameters

| Parameter | Description | Default |
|---|---|---|
| `[path]` | 审查目录，不指定则使用当前目录 | cwd |
| `--full` | 全量审查所有源文件（非仅变更文件） | off |
| `--branch <name>` | 对比目标分支的变更（merge 场景） | - |
| `--save` | 发现 issue 时自动保存报告，不询问用户 | off |
| `--no-save` | 不保存报告，不询问用户 | off |

> 不带 `--save` 或 `--no-save` 时，发现 issue 后交互式询问用户是否保存（默认行为）。

## Step 1: Validate Environment & Determine Scope

### Directory

- If user specifies a directory, use it. Otherwise use current working directory.
- Verify the directory is inside a git repository (`git rev-parse --show-toplevel`). If not, output the **Non-git Directory** template (see Step 5) and abort.

### Review Scope

- **Default (incremental):** Review only changed files. Collect changes via:
  ```bash
  # Staged changes (pre-commit scenario)
  git diff --cached --name-only --diff-filter=ACMR
  # Unstaged changes
  git diff --name-only --diff-filter=ACMR
  # Untracked new files
  git ls-files --others --exclude-standard
  ```
  If comparing against a target branch (e.g. merge scenario), use:
  ```bash
  git diff --name-only --diff-filter=ACMR <target-branch>...HEAD
  ```
- **Full project review:** Only when user explicitly requests. Review all tracked files matching project type filters.
- If no changed files are found, output the **No Changes** template (see Step 5) and exit.

### Filter Files

Only review relevant source files:
- **Frontend:** `*.js`, `*.jsx`, `*.ts`, `*.tsx`, `*.vue`, `*.svelte`, `*.html`, `*.css`, `*.scss`, `*.less`
- **Backend (Java):** `*.java`, `*.xml` (Spring/MyBatis configs), `*.yaml`/`*.yml` (application configs), `*.properties`
- **Database:** `*.sql` (DDL/DML scripts, migration files)
- Exclude: `node_modules/`, `dist/`, `build/`, `target/`, `.git/`, vendor dirs, generated code, test fixtures, lock files

### .reviewignore

如果审查目录根路径下存在 `.reviewignore` 文件，读取其中的规则并跳过匹配的文件/目录。语法与 `.gitignore` 一致：

- 每行一条规则，空行忽略
- `#` 开头为注释
- 支持 glob 模式：`*`、`**`、`?`、`[abc]`
- 以 `/` 结尾表示仅匹配目录
- `!` 开头表示取消忽略（优先级高于前面的规则）
- 路径相对于 `.reviewignore` 所在目录

示例 `.reviewignore`：
```
# 跳过生成的代码
src/generated/
**/generated/**

# 跳过特定模块
hj-group-common/
hj-group-provider/

# 跳过测试夹具
src/test/resources/fixtures/

# 但保留某个关键配置
!hj-group-common/src/main/resources/application.yml
```

**执行逻辑：**
1. 在收集变更文件之后、应用审查规则之前，检查审查目录下是否存在 `.reviewignore` 文件
2. 若存在，解析规则列表，对已收集的文件路径逐一匹配
3. 匹配到的文件从审查列表中移除（`!` 取消忽略的除外）
4. 在报告末尾的 `REVIEWED FILES` 区域中不展示被忽略的文件
5. 若所有文件均被忽略，等同于无变更，输出 **No Changes** 模板

## Step 2: Detect Project Type

Auto-detect by examining the repository root and changed files:

| Signal | Type |
|---|---|
| `pom.xml` or `build.gradle` or `*.java` files | **backend-java** |
| `package.json` or `*.vue`/`*.tsx`/`*.jsx` files | **frontend** |
| `*.sql` files, or MyBatis XML (`*Mapper.xml`), or DDL/migration scripts | **database** (always combined with other types) |
| Multiple signals present | **mixed** (apply all matching rule sets to respective files) |

> **Note:** Database rules are additive — when `*.sql` files or MyBatis Mapper XML are detected, database rules apply alongside the primary project type rules. For backend-java projects, database rules are always applied to MyBatis XML and SQL-related code.

## Step 3: Collect Changed Code

For each changed file, read the file content. For incremental reviews, also obtain the diff hunks (`git diff` / `git diff --cached`) to focus review on changed lines while using surrounding code as context.

Read related files when needed to understand:
- Import chains and dependency usage
- Interface/type definitions referenced in changed code
- Configuration that affects changed logic

## Step 4: Apply Review Rules

Review each changed file against the appropriate rule set. See detailed rules:

- **Backend (Java):** Read [references/backend-rules.md](references/backend-rules.md)
- **Frontend:** Read [references/frontend-rules.md](references/frontend-rules.md)
- **Database (MySQL):** Read [references/database-rules.md](references/database-rules.md) — applies to `*.sql` files, MyBatis Mapper XML, JPA/Hibernate entity definitions, DAO layer code, and database configuration

### Universal Rules (apply to all project types)

**安全：**
- 禁止硬编码密码、API 密钥、令牌等凭证
- 禁止在日志中输出敏感数据
- 非测试代码中禁止关闭安全控制

**逻辑：**
- 不得存在明显的 null/undefined 解引用
- 不得存在不可达代码或死分支
- 并发/异步代码不得存在竞态条件
- 不得存在资源泄漏（未关闭的流、连接、句柄）

**最佳实践：**
- 业务逻辑中禁止使用未命名的魔法数字/字符串
- 正确处理异常（禁止空 catch 块、禁止吞没错误）

## Step 5: Output Structured Results

### Severity Levels

| Level | Meaning | Blocks Push? |
|---|---|---|
| `L0` | 致命 - 可直接利用的安全漏洞、数据丢失/损坏风险 | Yes |
| `L1` | 严重 - 导致服务不可用、数据不一致、高概率运行时崩溃 | Yes |
| `L2` | 一般 - 潜在 Bug、性能退化、设计问题有实际影响 | No (warning) |
| `L3` | 轻微 - 有一定影响但影响有限的问题 | No (info) |

### Terminal Output Format

ALWAYS output results in this exact structure:

```
============================================================
  CODE REVIEW REPORT
============================================================
  Project Type : {frontend | backend-java | database | mixed}
  Review Scope : {incremental | full}
  Files Reviewed: {count}
  Date          : {YYYY-MM-DD HH:mm}
============================================================

------------------------------------------------------------
  SUMMARY
------------------------------------------------------------
  L0       : {count}
  L1       : {count}
  L2       : {count}
  L3       : {count}
  TOTAL    : {count}
  RESULT   : {PASS | FAIL}
------------------------------------------------------------
(FAIL when L0 > 0 or L1 > 0)

============================================================
  ISSUES
============================================================

[{severity}] {issue-id}: {中文简短标题}
  文件   : {file-path}
  行号   : {line-number or range}
  分类   : {安全 | 逻辑 | 设计 | 性能}
  规则   : {rule-id}
  描述   : {用中文描述具体问题}
  建议   : {用中文说明修复方式，可附代码示例}
------------------------------------------------------------

... (按严重程度从高到低排列)

> **语言要求**：issue 的标题、描述、建议必须使用中文，便于开发者阅读理解。代码片段保持原样。

============================================================
  REVIEWED FILES
============================================================
  {file-path-1}
  {file-path-2}
  ...
============================================================
```

If no issues found:
```
============================================================
  CODE REVIEW REPORT
============================================================
  Project Type  : {frontend | backend-java | database | mixed}
  Review Scope  : {incremental | full}
  Files Reviewed: {count}
  Date          : {YYYY-MM-DD HH:mm}
  RESULT        : PASS
  未发现问题，代码可以提交。
============================================================
```

### Early-Exit Templates

**Non-git Directory** (Step 1 abort):
```
============================================================
  CODE REVIEW ABORTED
============================================================
  Directory : {path}
  Error     : 非 Git 仓库。
              代码审查需要在 Git 管理的目录下执行。
============================================================
```

**No Changes** (Step 1 exit):
```
============================================================
  CODE REVIEW REPORT
============================================================
  Directory     : {path}
  Review Scope  : incremental
  Files Reviewed: 0
  RESULT        : SKIP
  没有需要审查的变更。
============================================================
```

### Machine-Readable Summary

After the human-readable report, also output a single JSON summary line for workflow integration:

```json
{"pass": true|false, "L0": N, "L1": N, "L2": N, "L3": N, "total": N, "files_reviewed": N}
```

This enables downstream tools to parse the result and decide whether to block commit/push.

## Step 6: Save Report

Report saving behavior depends on the parameter:

| Condition | `--save` | `--no-save` | Default (no flag) |
|---|---|---|---|
| issues > 0 | Auto-save, no prompt | Skip save, no prompt | Ask user whether to save |
| issues == 0 | Skip save | Skip save | Skip save |

**Save details:**
- Path: `{project-root}/review-result/{YYYYMMDD-HHmmss}-review.md`
- Create `review-result/` directory if it doesn't exist
- Output the saved file path after the report

**Default (interactive) mode:**
1. Display the full report in terminal first.
2. Ask the user: "审查发现 {N} 个问题。是否保存报告？(默认路径: {project-root}/review-result/{timestamp}-review.md)"
3. 用户确认则保存。用户指定自定义路径则使用该路径。
4. 用户拒绝则跳过保存。

## Usage Examples

### Standalone Execution

```
User: /rdc-code-review
→ Reviews staged + unstaged changes in current directory

User: /rdc-code-review ./backend
→ Reviews changes in the ./backend directory

User: /rdc-code-review --full
→ Full project review of all source files

User: /rdc-code-review --branch main
→ Reviews changes between current branch and main (merge scenario)
```

### Workflow Integration

When embedded as a sub-skill in a development workflow, use `--save` or `--no-save` to skip interactive prompts:

```
# Auto-save report, no user prompt
/rdc-code-review ./backend --save

# Output only, no save, no prompt
/rdc-code-review ./backend --no-save
```

The JSON summary output enables downstream tools to parse the result and decide whether to block commit/push.
