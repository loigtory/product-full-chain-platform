---
name: rdc-data-analysis
description: |
  AI 驱动的数据分析平台，覆盖从数据质量检查、探索性分析、可视化、代码生成到报告输出的完整工作流。
  触发场景：(1) 用户需要对 CSV/Excel/JSON 数据进行探索性分析 (2) 需要生成数据可视化图表 (3) 需要自动化完成端到端的数据分析流程 (4) 需要生成分析代码或研究假设 (5) 用户提到"数据分析"、"数据质量"、"可视化"、"EDA"等关键词
allowed-tools: Task Read Write Bash Grep Glob
metadata:
  name-zh: "数据分析助手"
  category: "data-analysis"
  version: "1.0.1"
  author: "研发中心"
  email: "hz_rdc@huize.com"
  department: "研发中心"
  tags: "data-analysis,visualization,statistics,python,EDA,reporting"
  ai-tools: "claude-code"
  dev-status: "published"
---

# 数据分析助手 (Data Analysis Assistant)

专业数据分析平台，根据用户意图自动路由到对应的工作模式，完成从数据质量检查到报告生成的完整分析流程。

## 工作模式

根据用户请求自动识别并执行对应模式。每种模式的详细参数和输出规范见 [references/commands.md](references/commands.md)。

| 模式 | 触发关键词 | 说明 |
|------|-----------|------|
| **分析模式** | "分析数据"、"EDA"、"统计分析"、"探索" | 探索性/统计/预测分析 |
| **可视化模式** | "可视化"、"图表"、"画图"、"趋势图" | 数据可视化图表生成 |
| **报告模式** | "生成报告"、"分析报告"、"写报告" | 分析报告 (md/html/pdf/docx) |
| **代码生成模式** | "生成代码"、"写脚本"、"分析脚本" | 生成 Python/R/SQL/JS 分析代码 |
| **质量检查模式** | "数据质量"、"检查数据"、"清洗数据" | 数据质量检查/清洗/验证 |
| **假设生成模式** | "生成假设"、"研究假设"、"实验设计" | 基于数据模式生成研究假设 |
| **全流程模式** | "完整分析"、"端到端"、"全面分析" | 自动编排以上所有模式 |

### 模式路由规则

1. 用户请求匹配单一模式时，直接执行该模式
2. 用户请求涉及多个模式时，按依赖关系串联执行（质量检查 → 分析 → 可视化 → 报告）
3. 用户请求"完整分析"或未明确指定时，执行全流程模式
4. 每个模式可独立运行，也可作为全流程的一个阶段

## 子智能体

每种工作模式由对应的子智能体执行，详细文档按需加载：

| 子智能体 | 对应模式 | 详细文档 |
|---------|---------|---------|
| data-explorer | 分析模式 | [references/agent-data-explorer.md](references/agent-data-explorer.md) |
| visualization-specialist | 可视化模式 | [references/agent-visualization.md](references/agent-visualization.md) |
| code-generator | 代码生成模式 | [references/agent-code-generator.md](references/agent-code-generator.md) |
| report-writer | 报告模式 | [references/agent-report-writer.md](references/agent-report-writer.md) |
| quality-assurance | 质量检查模式 | [references/agent-quality-assurance.md](references/agent-quality-assurance.md) |
| hypothesis-generator | 假设生成模式 | [references/agent-hypothesis-generator.md](references/agent-hypothesis-generator.md) |

## 全流程模式

当用户要求"完整分析"或"端到端分析"时，按以下 6 阶段顺序执行：

### 阶段 1: 数据质量评估

使用 quality-assurance 子智能体执行：
- 数据完整性、准确性、一致性检查
- 缺失值和异常值识别
- 生成质量评分（满分 100）
- **人类反馈点**: 等待用户确认质量可接受后再继续

### 阶段 2: 探索性数据分析

使用 data-explorer 子智能体执行：
- 描述性统计（均值、中位数、标准差、分位数）
- 相关性分析（Pearson、Spearman）
- 趋势和模式识别
- 聚类和分群分析

### 阶段 3: 研究假设生成

使用 hypothesis-generator 子智能体执行：
- 基于发现的模式生成可测试假设
- 设计实验验证方案和统计测试计划
- **人类反馈点**: 等待用户确认假设方向

### 阶段 4: 数据可视化

使用 visualization-specialist 子智能体执行：
- 创建综合仪表板和分析图表
- 趋势图、分布图、相关性热图、对比图
- 确保中文字体正确配置（见下方说明）

### 阶段 5: 代码生成

使用 code-generator 子智能体执行：
- 生成可重现的分析管道代码
- 包含数据预处理、质量检查、分析函数
- 附带单元测试和文档

### 阶段 6: 综合报告生成

使用 report-writer 子智能体执行：
- 整合所有分析结果
- 生成执行摘要 + 技术报告 + 附录
- 输出为用户指定格式 (markdown/html/pdf/docx)

## 中文可视化配置（必须）

生成任何 matplotlib 可视化之前，**必须**先配置中文字体，否则会出现乱码。使用以下跨平台自动检测代码：

```python
import platform
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties, fontManager

def get_chinese_font():
    """自动检测当前系统可用的中文字体"""
    system = platform.system()
    candidates = {
        'Darwin': ['Heiti TC', 'STHeiti', 'Hiragino Sans GB', 'PingFang SC'],
        'Windows': ['Microsoft YaHei', 'SimHei', 'FangSong', 'KaiTi'],
        'Linux': ['WenQuanYi Micro Hei', 'Noto Sans CJK SC', 'Droid Sans Fallback', 'AR PL UMing CN'],
    }
    available = {f.name for f in fontManager.ttflist}
    for font in candidates.get(system, candidates['Linux']):
        if font in available:
            return font
    return 'sans-serif'  # 最终回退

CHINESE_FONT = get_chinese_font()
plt.rcParams['font.family'] = CHINESE_FONT
plt.rcParams['axes.unicode_minus'] = False

font_prop = FontProperties(family=CHINESE_FONT)
font_prop_bold = FontProperties(family=CHINESE_FONT, weight='bold')
font_prop_small = FontProperties(family=CHINESE_FONT, size=9)

# 使用方式:
# ax.set_title('标题', fontproperties=font_prop_bold, fontsize=14)
# ax.set_xlabel('X轴', fontproperties=font_prop)
# ax.legend(prop=font_prop_small)
```

各平台字体优先级：

| 平台 | 优先级 |
|------|--------|
| macOS | Heiti TC → STHeiti → Hiragino Sans GB → PingFang SC |
| Windows | Microsoft YaHei → SimHei → FangSong → KaiTi |
| Linux | WenQuanYi Micro Hei → Noto Sans CJK SC → Droid Sans Fallback |

## 目录结构约定

分析项目应使用以下目录组织产出物：

```
项目根目录/
├── data_storage/          # 原始数据文件 (CSV/Excel/JSON)
├── analysis_reports/      # 分析报告
├── visualizations/        # 可视化图表
├── generated_code/        # 生成的分析代码
├── quality_reports/       # 数据质量报告
├── hypothesis_reports/    # 研究假设文档
└── complete_analysis/     # do-all 完整分析输出
    ├── data_quality_report/
    ├── exploratory_analysis/
    ├── hypothesis_reports/
    ├── visualizations/
    ├── generated_code/
    ├── final_report/
    └── workflow_log/
```

## 子智能体协作规则

- **data-explorer** 提供统计发现 → **visualization-specialist** 据此设计图表
- **data-explorer** 的模式发现 → **hypothesis-generator** 据此生成假设
- **quality-assurance** 先行验证数据 → 其他智能体基于干净数据工作
- **所有分析结果** → **report-writer** 整合为最终报告
- **code-generator** 为每个阶段的分析提供可重现代码

## 数据加载标准流程

```python
import pandas as pd
import numpy as np

# 1. 加载数据
df = pd.read_csv('data_storage/dataset.csv')  # 或 pd.read_excel()

# 2. 基础检查
print(f"数据维度: {df.shape}")
print(f"列名: {list(df.columns)}")
print(f"数据类型:\n{df.dtypes}")
print(f"缺失值:\n{df.isnull().sum()}")
print(f"重复记录: {df.duplicated().sum()}")

# 3. 描述性统计
print(df.describe())
```

## 质量评分标准

| 评分 | 等级 | 说明 |
|------|------|------|
| 90-100 | 优秀 | 数据质量高，适合关键分析 |
| 80-89 | 良好 | 数据可靠，有少量问题 |
| 70-79 | 一般 | 数据可用，有一定限制 |
| 60-69 | 较差 | 需要大量清洗 |
| <60 | 不可接受 | 不适合分析 |

各维度阈值：
- 完整性 ≥ 95%（关键字段），≥ 85%（其他字段）
- 准确性 ≥ 98%
- 一致性 ≥ 95%
- 唯一性 ≥ 99%（关键字段）
- 有效性 ≥ 97%

## Hooks 配置（可选）

本 Skill 附带两个可选的自动化 Hook 脚本，用户可手动配置到项目的 `.claude/settings.json` 中：

1. **scripts/validate-analysis.py** (PostToolUse → Write|Edit): 自动验证分析产出文件（CSV 格式、Python 安全性、JSON 格式）
2. **scripts/context-loader.py** (UserPromptSubmit): 自动加载项目上下文（可用数据集、已生成可视化、最近活动）

配置模板见 `assets/settings.json`，用户需将 hook 路径调整为实际安装路径后复制到项目配置中。

## 使用示例

用户通过自然语言触发对应工作模式：

```
用户: 帮我分析一下 data_storage/sales_data.csv 的数据
→ 触发「分析模式」，执行探索性数据分析

用户: 帮我画几个图表看看销售趋势
→ 触发「可视化模式」，生成趋势图和分布图

用户: 检查一下客户数据的质量，清洗掉重复和缺失值
→ 触发「质量检查模式」，执行数据清洗

用户: 生成一段 Python 代码来做统计分析
→ 触发「代码生成模式」，输出可复现的分析脚本

用户: 对用户行为数据做一次完整分析，输出 PDF 报告
→ 触发「全流程模式」，按 6 阶段依次执行
```
