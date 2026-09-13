# 静态闸白名单补充确认

状态：CONFIRMED。用户已回复“确认”，仅授权以下一行修改。补充记录见[独立授权](../static-gate-supplement-authorization.json)，原授权和保护基线保持原值。

40号要求index.html加载新增local-session.js，脚本从42变为43；原35条闸中的verify-prototype.mjs还会调用不在67路径白名单内的verify-static.mjs，该文件固定断言42，会阻断第1条闸。现有静态闸仍检查脚本唯一性、原型JS语法、CSS存在及业务模块lint；不删断言、不跳过子闸。

申请仅增加一个精确文件：output/pfc-workbench-prototype/verify-static.mjs。修改仅以下一行：

```diff
-assert.equal(scripts.length, 42);
+assert.equal(scripts.length, 43);
```

新local-use架构闸另外验证local-session.js在app.js之前且只出现一次。总门禁仍35；源码/工具/测试白名单由67变68，其余目标、文档、数据/进程和发布边界不变。本次确认后追加授权记录并在当前保护指纹核验中只排除此已批准单文件；保留原protected-baseline作为开工事实，不覆写历史证据。
