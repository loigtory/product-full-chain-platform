# <迭代 ID> 交付检查点

## 交付定位

| 字段       | 内容                                               |
| ---------- | -------------------------------------------------- |
| Parent POD | `<POD-ID>`                                         |
| 当前里程碑 | `<M1/M2/M3>`                                       |
| CAP / Unit | `<CAP-ID>` / `<UNIT-ID...>`                        |
| 权威版本   | `<source/version>`                                 |
| 实现状态   | `PLANNED / IMPLEMENTING / LOCAL_VERIFIED`          |
| 集成状态   | `NOT_STARTED / BLOCKED / IN_PROGRESS / INTEGRATED` |
| 验收状态   | `NOT_STARTED / BLOCKED / ACCEPTED`                 |
| 依赖来源   | `REAL_LOCAL / REMOTE / FIXTURE / UNAVAILABLE`      |

## 当前版本

- 目标：
- 非目标：
- 本轮退出条件：
- 延后项及 Owner：
- 风险和回滚：

## 数据与验证

- 业务事实存储及 schema：
- 测试数据设计、runId、createdIds：
- 精确验证命令和结果：
- 清理或保留读回：
- 未验证风险及接受人：

## POD 回写

- 本 CAP/Unit 状态变化：
- 当前里程碑是否满足全部跨 CAP 退出条件：
- 平台总体状态：
- 唯一下一路线：

禁止以本检查点的 Txx、CAP 或局部门禁 PASS 代替父 POD 完成结论。
