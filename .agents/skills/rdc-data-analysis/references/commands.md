# 斜杠命令详细说明

本文档详细描述数据分析助手的 7 个斜杠命令的参数、用法和预期输出。

## 目录

- [/analyze - 数据分析](#analyze---数据分析)
- [/visualize - 数据可视化](#visualize---数据可视化)
- [/report - 报告生成](#report---报告生成)
- [/generate - 代码生成](#generate---代码生成)
- [/quality - 数据质量](#quality---数据质量)
- [/hypothesis - 假设生成](#hypothesis---假设生成)
- [/do-all - 全自动分析](#do-all---全自动分析)
- [命令组合最佳实践](#命令组合最佳实践)

---

## /analyze - 数据分析

执行数据分析，使用 data-explorer 子智能体。

**参数**: `[dataset] [analysis_type]`

| 参数 | 说明 | 可选值 |
|------|------|--------|
| dataset | 数据集文件名（位于 data_storage/ 目录） | CSV/Excel/JSON 文件 |
| analysis_type | 分析类型 | exploratory, statistical, predictive, complete |

**分析类型**:
- **exploratory**: 基础数据理解、摘要统计、数据质量评估、初步模式识别
- **statistical**: 高级统计测试、相关性和回归分析、假设检验、置信区间
- **predictive**: 特征重要性分析、预测建模准备、变量关系、模型推荐
- **complete**: 以上所有 + 综合报告 + 可视化建议

**输出文件**:
- `analysis_reports/analysis_summary_<dataset>.md` - 详细分析报告
- `analysis_reports/statistical_summary_<dataset>.csv` - 统计摘要表
- `analysis_reports/data_quality_<dataset>.json` - 数据质量评估

**示例**:
```bash
/analyze user_behavior.csv exploratory
/analyze sales_data.csv statistical
/analyze customer_data.csv predictive
/analyze financial_data.csv complete
```

---

## /visualize - 数据可视化

创建数据可视化，使用 visualization-specialist 子智能体。

**参数**: `[dataset] [chart_type]`

| 参数 | 说明 | 可选值 |
|------|------|--------|
| dataset | 数据集文件名 | CSV/Excel/JSON 文件 |
| chart_type | 图表类型 | all, trends, distribution, correlation, comparison, custom |

**重要**: 生成可视化前必须配置中文字体（详见 SKILL.md 中文可视化配置部分）。

**图表类型**:
- **all**: 综合仪表板，包含多种图表类型
- **trends**: 时间序列折线图、移动平均、趋势分解
- **distribution**: 直方图、箱线图、小提琴图、Q-Q 图
- **correlation**: 相关性热图、散点矩阵、配对图
- **comparison**: 柱状图、分组图、小面积图
- **custom**: 用户自定义可视化

**输出文件**:
- `visualizations/dashboard_<dataset>.html` - 交互式仪表板
- `visualizations/summary_<dataset>.png` - 摘要图表
- `visualizations/detailed_<dataset>.pdf` - 详细分析图表
- `visualizations/charts_<dataset>.py` - 可复现代码

**示例**:
```bash
/visualize user_behavior.csv all
/visualize sales_data.csv trends
/visualize customer_data.csv distribution
```

---

## /report - 报告生成

生成分析报告，使用 report-writer 子智能体。

**参数**: `[dataset] [report_type] [format]`

| 参数 | 说明 | 可选值 |
|------|------|--------|
| dataset | 数据集文件名 | CSV/Excel/JSON 文件 |
| report_type | 报告类型 | summary, complete, executive, technical, custom |
| format | 输出格式 | markdown, html, pdf, json, docx |

**报告类型**:
- **summary**: 简要概述（1-2 页），关键发现和建议
- **complete**: 完整文档，含方法论、统计分析、技术附录
- **executive**: 商务导向，KPI、战略建议、行动计划
- **technical**: 详细方法论、统计结果、可复现细节
- **custom**: 用户自定义结构

**报告结构**:
1. 标题页
2. 执行摘要
3. 介绍与背景
4. 方法论
5. 分析结果
6. 讨论与解读
7. 结论与建议
8. 参考文献
9. 技术附录

**示例**:
```bash
/report user_behavior.csv complete markdown
/report sales_data.csv executive pdf
/report customer_data.csv technical html
```

---

## /generate - 代码生成

生成分析代码，使用 code-generator 子智能体。

**参数**: `[language] [analysis_type]`

| 参数 | 说明 | 可选值 |
|------|------|--------|
| language | 编程语言 | python, r, sql, javascript |
| analysis_type | 分析类型 | data-cleaning, statistical, visualization, machine-learning, custom |

**语言支持**:
- **Python**: pandas, numpy, matplotlib, seaborn, scikit-learn, plotly
- **R**: tidyverse, ggplot2, dplyr, caret, shiny
- **SQL**: PostgreSQL, MySQL, SQLite, BigQuery
- **JavaScript**: D3.js, Plotly.js, Chart.js, TensorFlow.js

**代码标准**:
- 模块化设计，关注点分离
- 完善的错误处理和日志
- 类型注解和文档字符串
- 包含单元测试

**输出文件**:
- `generated_code/<lang>_<type>_analysis.py` - 主分析脚本
- `generated_code/<lang>_<type>_utils.py` - 工具函数
- `generated_code/<lang>_<type>_test.py` - 单元测试
- `generated_code/requirements_<lang>.txt` - 依赖清单

**示例**:
```bash
/generate python data-cleaning
/generate r statistical
/generate sql reporting
/generate javascript visualization
```

---

## /quality - 数据质量

执行数据质量操作，使用 quality-assurance 子智能体。

**参数**: `[dataset] [action]`

| 参数 | 说明 | 可选值 |
|------|------|--------|
| dataset | 数据集文件名 | CSV/Excel/JSON 文件 |
| action | 质量操作 | check, clean, validate, monitor, profile |

**操作类型**:
- **check**: 基础质量评估（完整性、准确性、一致性）
- **clean**: 数据清洗（去重、缺失值处理、格式修正）
- **validate**: 综合验证（统计验证、业务规则、交叉验证）
- **monitor**: 配置持续质量监控
- **profile**: 生成详细数据画像

**质量维度**:
- 完整性 (Completeness)
- 准确性 (Accuracy)
- 一致性 (Consistency)
- 时效性 (Timeliness)
- 唯一性 (Uniqueness)
- 有效性 (Validity)

**输出文件**:
- `quality_reports/<dataset>_quality_check.json` - 质量评估结果
- `quality_reports/<dataset>_data_profile.json` - 数据画像
- `quality_reports/<dataset>_validation_report.md` - 验证报告

**示例**:
```bash
/quality user_behavior.csv check
/quality sales_data.csv clean
/quality customer_data.csv validate
```

---

## /hypothesis - 假设生成

生成研究假设，使用 hypothesis-generator 子智能体。

**参数**: `[dataset] [domain]`

| 参数 | 说明 | 可选值 |
|------|------|--------|
| dataset | 数据集文件名 | CSV/Excel/JSON 文件 |
| domain | 分析领域 | user-behavior, business-impact, technical-performance, custom |

**假设类型**:
- **描述性假设**: 描述数据模式和关系
- **解释性假设**: 解释因果关系
- **预测性假设**: 预测未来结果
- **处方性假设**: 推荐最优行动

**输出文件**:
- `hypothesis_reports/<dataset>_<domain>_hypotheses.md` - 假设文档
- `hypothesis_reports/<dataset>_<domain>_experimental_design.md` - 实验设计
- `hypothesis_reports/<dataset>_<domain>_validation_plan.md` - 验证方案

**示例**:
```bash
/hypothesis user_behavior.csv user-behavior
/hypothesis sales_data.csv business-impact
/hypothesis system_metrics.csv technical-performance
```

---

## /do-all - 全自动分析

自动化完成整个数据分析工作流程，整合以上所有命令功能。

**参数**: `[dataset] [domain] [output_format]`

| 参数 | 说明 | 可选值 |
|------|------|--------|
| dataset | 数据集文件名 | CSV/Excel/JSON 文件 |
| domain | 分析领域 | user-behavior, business-impact, technical-performance, custom |
| output_format | 输出格式 | markdown, html, pdf, docx |

**执行流程**:
1. 数据质量评估 → 人类反馈点
2. 探索性数据分析
3. 研究假设生成 → 人类反馈点
4. 数据可视化 → 人类反馈点
5. 代码生成
6. 综合报告生成

**输出目录结构**:
```
complete_analysis/
├── data_quality_report/
├── exploratory_analysis/
├── hypothesis_reports/
├── visualizations/
├── generated_code/
├── final_report/
└── workflow_log/
```

**示例**:
```bash
/do-all user_behavior.csv user-behavior markdown
/do-all sales_data.csv business-impact pdf
/do-all system_metrics.csv technical-performance html
```

---

## 命令组合最佳实践

```bash
# 标准分析流程
/quality data.csv check         # 先检查质量
/analyze data.csv exploratory   # 探索性分析
/visualize data.csv all         # 全面可视化
/report data.csv complete markdown  # 生成报告

# 快速洞察
/analyze data.csv statistical   # 统计分析
/visualize data.csv correlation # 相关性图表

# 研究导向
/analyze data.csv complete      # 完整分析
/hypothesis data.csv business-impact  # 生成假设
/generate python machine-learning     # 生成 ML 代码
```
