# Database (MySQL) Review Rules

> 基于《慧择数据库研发规范》，适用于 SQL 文件、DDL 脚本、MyBatis Mapper XML、JPA/Hibernate 实体、DAO 层代码及应用配置中的数据库相关内容。
>
> Severity: L0(致命) > L1(严重) > L2(一般) > L3(轻微)
> L0/L1 阻断 push，L2 警告，L3 提示

## Naming (命名规范)

| Rule ID | Rule | Severity | Rationale |
|---|---|---|---|
| DB-NM01 | 数据库名、表名、字段名超过 32 个字符 | L2 | 违反命名长度限制，影响可维护性 |
| DB-NM02 | 数据库名、表名、字段名使用了 MySQL 保留字（如 `show`、`order`、`key`、`status` 等） | L1 | 导致 SQL 执行异常或需要反引号转义，埋下隐患 |
| DB-NM03 | 表名、字段名包含大写字母或非法字符（只允许小写字母、数字、下划线） | L2 | 不同系统大小写敏感性不一致，跨平台迁移出错 |
| DB-NM04 | 中间表未以 `_tmp` 结尾，备份表未以 `_bak` 结尾 | L2 | 强制命名规范，不合规将被 DBA 打回 |

## Table Structure (表结构设计)

| Rule ID | Rule | Severity | Rationale |
|---|---|---|---|
| DB-TS01 | 建表未显式指定字符集为 `utf8mb4`（或与旧表关联时的 `utf8`） | L2 | 隐式字符集可能导致乱码或 JOIN 性能问题 |
| DB-TS02 | 建表未显式指定存储引擎 `InnoDB` | L2 | 非 InnoDB 引擎不支持事务、行锁、MVCC 等关键特性 |
| DB-TS03 | 表或字段缺少 `COMMENT` 注释 | L2 | 缺少注释导致表结构难以理解和维护 |
| DB-TS04 | 建表时使用数据库物理外键（`FOREIGN KEY` 约束） | L1 | 高并发下导致死锁，降低可用性，应在业务端实现参照完整性（DB-FD03 从禁止语法角度同样覆盖） |
| DB-TS05 | 在数据库中存储图片、文件等大二进制数据 | L1 | 严重影响数据库性能和备份效率 |
| DB-TS06 | 主键不是 `id` 类型为无符号 `int`/`bigint` 且 `AUTO_INCREMENT`；或使用了 UUID/字符串/组合主键 | L1 | 非自增主键导致 InnoDB 页分裂和大量随机 I/O，二级索引膨胀；自增列推荐无符号类型（大表/日志表用无符号 `bigint`） |
| DB-TS07 | 建表缺少 `create_time`、`update_time`、`deleted` 必要字段 | L1 | 缺少审计字段和软删除标识，无法支持数据追溯和安全删除 |
| DB-TS08 | `update_time` 字段未设置 `ON UPDATE CURRENT_TIMESTAMP` 或未建立索引 | L2 | 影响数据同步和大数据量物理删除场景的性能 |
| DB-TS09 | 业务代码中执行物理删除（`DELETE`）而非逻辑删除（更新 `deleted` 字段） | L1 | 物理删除不可逆，违反数据安全规范，需走 DBA 流程 |
| DB-TS10 | 字段允许 `NULL` 但无业务必要性（应尽量 `NOT NULL` 加 `DEFAULT` 值） | L3 | NULL 占额外存储、聚合函数计算偏差、数据迁移易出错 |

## Partition & Sharding (分区表/分库分表)

| Rule ID | Rule | Severity | Rationale |
|---|---|---|---|
| DB-PT01 | 访问分区表的 SQL 未包含分区键 | L1 | 无分区键导致扫描所有分区，性能急剧下降 |
| DB-PT02 | 分区表的分区字段未建索引，或不是组合索引的首列 | L2 | 分区字段无索引会退化为分区内全表扫描 |
| DB-PT03 | 单个分区表的分区数超过 1024 | L2 | 超过 MySQL 分区上限，DDL 将失败 |

## Column Types (列数据类型)

| Rule ID | Rule | Severity | Rationale |
|---|---|---|---|
| DB-CT01 | JOIN 关联字段的数据类型、字符集或排序规则不一致 | L1 | 导致隐式转换无法使用索引，查询性能急剧下降 |
| DB-CT02 | 时间字段使用 `TIMESTAMP` 类型而非 `DATETIME` | L1 | TIMESTAMP 范围仅到 2038 年，存储会员服务等长期时间会溢出 |
| DB-CT03 | 金额、余额等财务字段未使用 `DECIMAL(M,D)` | L2 | 浮点类型存在精度丢失，导致财务计算错误 |
| DB-CT04 | 使用 `ENUM` 或 `SET` 类型 | L3 | 浪费空间且枚举值变更不便，应使用 `TINYINT`/`SMALLINT` 代替 |
| DB-CT05 | 不必要地使用 `BLOB`、`TEXT`、`JSON` 类型（未做垂直拆分） | L3 | 大字段加载到内存浪费空间，影响查询性能，建议拆分到独立表 |
| DB-CT06 | `VARCHAR` 字段字符数超过 2700 | L3 | 接近 MySQL 行大小限制，建议评估是否需要调整数据模型 |

## Index (索引设计)

| Rule ID | Rule | Severity | Rationale |
|---|---|---|---|
| DB-IX01 | 在低基数列上单独建索引（如性别、状态等区分度极低的字段） | L2 | 索引选择性差，优化器可能不使用，浪费空间和写入性能 |
| DB-IX02 | WHERE 条件中对索引列使用函数或数学运算（如 `WHERE LOWER(name)=...`、`WHERE id+2=...`） | L2 | 导致索引失效，退化为全表扫描 |
| DB-IX03 | 单表索引超过 5 个，或单个索引中字段数超过 5 个 | L3 | 过多索引降低写入速度、增加磁盘占用；过宽索引维护成本高，需综合评估 |
| DB-IX04 | 存在冗余索引（如已有 `key(a,b)` 又单独建 `key(a)`） | L3 | 冗余索引浪费空间和写入性能 |
| DB-IX05 | 主键（`id`）被更新 | L1 | 聚簇索引键变更导致数据页重组，严重影响性能和数据一致性 |
| DB-IX06 | 索引命名不规范：主键应以 `pk_` 开头，唯一键以 `uk_`/`uq_` 开头，普通索引以 `idx_` 开头 | L3 | 命名不统一影响可维护性 |

## SQL Writing (SQL 编写规范)

| Rule ID | Rule | Severity | Rationale |
|---|---|---|---|
| DB-SQ01 | 非静态小表的 DML 语句（`SELECT`/`UPDATE`/`DELETE`）缺少 `WHERE` 条件 | L0 | 全表操作可导致数据丢失或服务不可用 |
| DB-SQ02 | `WHERE` 条件等号两侧字段类型不一致（隐式类型转换） | L1 | 隐式转换导致索引失效，引发全表扫描 |
| DB-SQ03 | 使用 `SELECT *` 而非指定具体字段 | L2 | 读取不必要的数据造成 I/O 和网络压力，表结构变更引发兼容问题。注意：若同时缺少分页限制则升级为 L1（参见 backend PERF-J02） |
| DB-SQ04 | 使用 hint（`sql_no_cache`、`force index`、`ignore key`、`straight join`） | L1 | 数据分布变化后 hint 可能导致更差的执行计划 |
| DB-SQ05 | 单表超过 1 万行时仅使用全模糊 `LIKE '%xxx%'` 查询，无其他等值或范围条件 | L2 | 全模糊无法使用索引，大表上导致全表扫描 |
| DB-SQ06 | `INSERT INTO ... VALUES` 批量插入超过 5000 行 | L2 | 引起主从同步延迟 |
| DB-SQ07 | 使用 `UNION` 而非 `UNION ALL`（不需要去重场景），或 `UNION` 子句超过 5 个 | L3 | `UNION` 额外执行去重排序，浪费 CPU 资源；子句过多加剧性能开销 |
| DB-SQ08 | `IN` 列表超过 500 个值 | L3 | 底层扫描量大，增加数据库压力 |
| DB-SQ09 | `INSERT` 语句未指定具体字段名（`INSERT INTO t1 VALUES(...)`） | L3 | 表结构变更后导致插入错误 |
| DB-SQ10 | 大表分页查询 `LIMIT` 起点过高且未优化（未用主键过滤缩小范围） | L3 | 高偏移分页性能急剧下降 |
| DB-SQ11 | 使用 `ORDER BY RAND()` | L1 | 全表数据加载到内存排序，消耗大量 I/O 和 CPU |
| DB-SQ12 | `ORDER BY`/`GROUP BY`/`DISTINCT` 结果集超过 1000 行且未利用索引 | L3 | CPU 密集操作，大结果集严重影响性能 |

## Multi-table Join (多表连接)

| Rule ID | Rule | Severity | Rationale |
|---|---|---|---|
| DB-JN01 | 跨数据库 JOIN | L1 | 增加模块耦合，阻碍未来数据库拆分 |
| DB-JN02 | 在 `UPDATE`/`DELETE` 等更新语句中使用 `JOIN` 语法（如 `UPDATE t1 JOIN t2 ...`） | L1 | 联表更新风险高，易导致数据不一致（另见 DB-FD05 逗号分隔的多表更新语法） |
| DB-JN03 | 多表 JOIN 超过 3 个表 | L2 | 执行计划复杂度指数增长，性能不可控 |
| DB-JN04 | 被驱动表的连接列缺少索引 | L2 | JOIN 执行效率极低，退化为嵌套循环全表扫描 |
| DB-JN05 | 使用子查询（可用 JOIN 或程序端拆分替代） | L3 | 子查询性能通常低于等价 JOIN |

## Transaction (事务规范)

| Rule ID | Rule | Severity | Rationale |
|---|---|---|---|
| DB-TX01 | 显式开启事务后缺少配对的 `COMMIT` 或 `ROLLBACK` | L1 | 未关闭事务占用连接和锁资源，可导致服务不可用 |
| DB-TX02 | 单纯 `SELECT` 查询被包裹在事务中 | L2 | 无意义地占用事务资源，增加锁争用风险 |
| DB-TX03 | 事务中单条语句操作行数超过 5000 行，或 `IN` 参数超过 500 | L1 | 大事务导致主从延迟、锁等待超时 |
| DB-TX04 | 事务内包含超过 5 条 SQL（支付业务除外） | L2 | 长事务导致锁持有时间过长，影响并发 |
| DB-TX05 | 事务中更新语句未基于主键或唯一键（`UPDATE ... WHERE` 非主键条件） | L3 | RR 隔离级别下产生间隙锁，增大死锁概率 |
| DB-TX06 | 事务内包含外部调用（如 HTTP 请求、文件操作） | L2 | 外部调用阻塞导致事务过长，数据库连接被占用 |

## Forbidden Patterns (线上禁止)

| Rule ID | Rule | Severity | Rationale |
|---|---|---|---|
| DB-FD01 | 带 `LIMIT` 的 `UPDATE` 或 `DELETE` 语句 | L0 | 导致主从数据不一致，数据错乱 |
| DB-FD02 | 关联子查询更新（`UPDATE t1 SET ... WHERE name IN (SELECT ...)`) | L0 | 效率极低，大表可导致长时间锁表 |
| DB-FD03 | 使用 `PROCEDURE`、`FUNCTION`、`TRIGGER`、`VIEW`、`EVENT`、外键约束 | L1 | 消耗数据库资源，降低实例可扩展性，应在程序端实现 |
| DB-FD04 | 使用 `INSERT INTO ... ON DUPLICATE KEY UPDATE` | L1 | 高并发下造成主从不一致 |
| DB-FD05 | 逗号分隔的联表更新语句（`UPDATE t1, t2 WHERE t1.id = t2.id ...`） | L1 | 多表同时更新风险高，应拆分为独立语句（另见 DB-JN02 的 JOIN 语法联表更新） |
| DB-FD06 | `CREATE TABLE xxx AS SELECT ...` | L1 | GTID 主从复制不支持此语法 |

## DAO & Connection (程序层设计)

| Rule ID | Rule | Severity | Rationale |
|---|---|---|---|
| DB-DA01 | 程序端对数据库显式加锁（如 `SELECT ... FOR UPDATE` 无必要场景、手动 `LOCK TABLES`） | L1 | 外部锁不可控，高并发下导致死锁和服务不可用 |
| DB-DA02 | 连接池未配置初始/最小/最大连接数和超时时间 | L2 | 连接耗尽导致服务不可用（单连接约占 16MB 内存） |
| DB-DA03 | log/history 类型表缺少数据清理或归档方案 | L2 | 数据持续增长导致表膨胀，查询性能劣化 |
| DB-DA04 | MyBatis Mapper 使用 `${}` 拼接而非 `#{}` 参数化 | L0 | 等同于 SQL 注入，可直接利用（与 backend-rules FW-J01 同源，同时检查） |
| DB-DA05 | 未考虑主从延迟对业务的影响（强一致性读未走主库） | L3 | 从库延迟期间读取到过期数据 |
| DB-DA06 | 批量更新未做分批处理和必要 sleep | L2 | 一次性大量更新导致主从同步延迟和锁争用 |
| DB-DA07 | 同一表的多次 `ALTER TABLE` 未合并为一条语句 | L2 | 每次 ALTER 都会锁表或产生 MDL 锁，多次执行放大影响 |
| DB-DA08 | 数据源/连接字符串中字符集配置与数据库不一致（应统一为 `utf8mb4` 或 `utf8`） | L2 | 字符集不一致导致乱码和 JOIN 隐式转换 |
