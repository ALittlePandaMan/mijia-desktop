# S400 云端同步修正

适用已支持的 `yunmai.scales.ms103`。本次真实账号只读诊断确认两个故障：

1. 使用 `mijia` 会话时，体脂秤接口被错误发送到 `core.api.mijia.tech`。`/eco/common/scale/indexInfo` 返回 HTTP 404；同一请求发送到业务主机 `api.mijia.tech` 后返回 HTTP 200、code 0，取得 3 位成员。`/eco/scale/getData` 同样成功取得 14 条记录。
2. 记录中的 `data.user.id` 是成员资料的 `id`，程序却将其与蓝牙成员匹配编码 `accountCode` 比较。上述 14 条记录因此会全部被错误过滤。只读返回确认记录的内外层 `accountId` 均匹配当前成员，`data.user.id` 与成员资料 `id` 相同，与 `accountCode` 不同。

修正体脂秤已有接口的业务主机分流，采用精确路径白名单，不开放任意 `/eco` 路由；将记录成员标识与资料 `id` 比较。保留型号、设备、云账号、内外层成员账号、时间范围和权限校验。

接口及参数同时参考此前保留的原版体脂秤插件 1013486/v167 静态材料：`EcoRequest.getUserListDeviceConfig`、`getRecordsByFilter`；成员查找分别通过 `findUserByUid(accountId)` 和 `findUserByAccountCode(accountCode)`。历史静态 Evidence 为 `ev_f387f7b06ef068d8f55a693cba1e1148d00c57e9586224378112d5d0360972e0`，不将其视作本次运行结果。当前故障和字段对应关系由本次真实云端只读返回确认。

只保存主机、状态码、数据结构及数量，不保存账号标识、成员资料、体重、身体指标或凭据。构建后通过本地 MCP 的 `scale_history` 读取接口核对原生解析结果，结果单独记录在交付记录中。

本次不运行自动化测试或浏览器检查，不触发称重、蓝牙同步、上传、成员编辑、认领或删除。尚未验证待领数据操作、成员写入、多成员切换和历史翻页，不将这些场景记为通过。
