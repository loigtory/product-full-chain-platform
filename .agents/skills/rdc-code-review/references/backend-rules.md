# Backend (Java) Review Rules

> Severity: L0(致命) > L1(严重) > L2(一般) > L3(轻微)
> L0/L1 阻断 push，L2 警告，L3 提示

## Security

| Rule ID | Rule | Severity | Rationale |
|---|---|---|---|
| SEC-J01 | SQL 注入：SQL 查询使用字符串拼接而非参数化查询 / PreparedStatement | L0 | 可直接导致数据泄露或篡改 |
| SEC-J02 | XSS：未过滤的用户输入直接渲染到响应中（特别是 Spring MVC 控制器） | L0 | 可被直接利用窃取用户凭证 |
| SEC-J03 | 路径穿越：用户输入直接用于文件路径且未做校验 | L0 | 可读取/覆盖服务器任意文件 |
| SEC-J04 | 反序列化漏洞：对不可信数据使用 `ObjectInputStream.readObject()` 且未做类型过滤 | L0 | 可远程代码执行 (RCE) |
| SEC-J05 | 命令注入：`Runtime.exec()` 或 `ProcessBuilder` 使用未过滤的用户输入 | L0 | 可远程代码执行 (RCE) |
| SEC-J06 | SSRF：HTTP 请求中使用用户可控的 URL 且未做白名单校验 | L1 | 可探测内网、访问元数据服务 |
| SEC-J07 | XXE：XML 解析未禁用外部实体（`DocumentBuilderFactory`、`SAXParserFactory`） | L0 | 可读取服务器文件或发起 SSRF |
| SEC-J08 | 硬编码凭证：代码或配置文件中包含密码、密钥、令牌 | L1 | 代码泄露即导致凭证泄露 |
| SEC-J09 | 弱加密算法：使用 MD5/SHA1 做密码哈希、ECB 模式、硬编码 IV/密钥 | L2 | 降低加密保护强度，存在被破解风险 |
| SEC-J10 | 接口缺少认证/授权校验 | L1 | 未授权访问可导致数据泄露或越权操作 |
| SEC-J11 | CORS 配置不当：过于宽松的 `Access-Control-Allow-Origin`（如允许 `*` 且携带凭证） | L2 | 需配合其他攻击向量利用，但增大攻击面 |
| SEC-J12 | 日志中暴露敏感信息（`logger.info(password)`、记录个人隐私数据） | L2 | 日志系统被访问后导致敏感信息泄露 |
| SEC-J13 | 状态变更接口缺少 CSRF 防护 | L2 | 需要用户交互才能利用 |
| SEC-J14 | 文件上传未校验：上传接口缺少文件类型、大小或内容校验 | L1 | 可上传恶意文件导致 RCE 或存储滥用 |
| FW-J01 | MyBatis 使用 `${}` 拼接而非 `#{}` 参数化（SQL 注入） | L0 | 等同于 SQL 注入，可直接利用 |
| FW-J02 | 错误响应中暴露堆栈信息（缺少全局异常处理器） | L2 | 信息泄露，攻击者可利用堆栈信息 |
| FW-J03 | 对外接口缺少请求限流 | L2 | 缺少限流可导致接口被滥用或 DDoS |

## Logic

| Rule ID | Rule | Severity | Rationale |
|---|---|---|---|
| LOG-J01 | 空指针风险：未做 null 检查直接解引用，特别是 `.get()`、`.findFirst()` 之后 | L2 | Java 最常见的运行时异常 |
| LOG-J02 | Optional 未检查：调用 `.get()` 前未使用 `.isPresent()` / `.orElse()` | L2 | 必然抛出 NoSuchElementException |
| LOG-J03 | 资源泄漏：流、连接、读取器未关闭（缺少 try-with-resources） | L1 | 资源耗尽导致服务不可用 |
| LOG-J04 | 并发缺陷：共享可变状态未同步、非原子性的先检查后执行操作 | L1 | 数据竞争导致数据损坏，难以复现和排查 |
| LOG-J05 | 异常吞没：空 catch 块或捕获后未记录日志直接忽略 | L2 | 隐藏真实错误，严重影响问题排查 |
| LOG-J06 | equals/hashCode 实现错误：只覆写其一，或使用了可变字段 | L2 | 在 HashMap/HashSet 中导致隐蔽的逻辑错误 |
| LOG-J07 | 字符串使用 `==` 比较而非 `.equals()` | L3 | Java 常见逻辑错误，但影响范围通常有限 |
| LOG-J08 | 整数溢出：int 运算未做边界检查 | L3 | 业务场景中较少触发但可能导致计算错误 |
| LOG-J09 | 死循环风险：循环退出条件可能永远无法满足 | L1 | 导致线程阻塞或服务挂起 |
| LOG-J10 | 事务边界不当：需要原子性的操作分散在多个事务中，或事务过长持有数据库锁 | L1 | 导致数据不一致或数据库锁争用 |

## Design & Maintainability

| Rule ID | Rule | Severity | Rationale |
|---|---|---|---|
| BP-J01 | 多次 DB 写操作的 Service 方法缺少 `@Transactional` | L1 | 部分写入成功导致数据不一致 |
| BP-J02 | N+1 查询问题：在循环中查询数据库而非批量查询/关联查询 | L2 | 数据量增长后导致严重性能退化 |
| BP-J03 | 捕获宽泛的 `Exception` 或 `Throwable` 而非具体异常类型 | L3 | 可能意外捕获不应处理的异常，影响问题定位 |
| BP-J04 | Controller 参数缺少入参校验（Bean Validation / `@Valid`） | L2 | 系统边界缺少校验，可能导致脏数据或异常 |
| BP-J05 | API 响应直接暴露内部实体（应使用 DTO） | L2 | 可能泄露敏感字段，且内部结构变更直接影响 API |
| BP-J06 | 线程不安全的单例：Spring 单例 Bean 包含可变实例字段 | L1 | 并发环境下数据竞争导致不可预测行为 |
| BP-J07 | 魔法值：业务逻辑中使用字面量而非命名常量 | L3 | 业界共识的可维护性问题，降低代码可读性且易在多处修改时遗漏 |

## Performance

| Rule ID | Rule | Severity | Rationale |
|---|---|---|---|
| PERF-J01 | 循环中拼接字符串：应使用 `StringBuilder` | L3 | 大循环下产生大量临时对象，影响 GC |
| PERF-J02 | 无限制查询：`SELECT *` 或列表接口缺少分页 | L1 | 数据量大时可导致 OOM 或拖垮数据库 |
| PERF-J03 | 异步/响应式上下文中执行阻塞调用 | L2 | 阻塞线程池，降低系统吞吐 |
