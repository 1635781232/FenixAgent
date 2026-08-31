# 企业授权测试说明

企业授权通过 Core 授权端口接入，业务模块不直接依赖具体授权引擎。授权契约位于 `@fenix/authorization-plugin`，当前 OpenFGA 实现位于 `@fenix/openfga-authorization-plugin`。Core 仅按模块契约加载插件，不 import OpenFGA。

## 配置

```dotenv
RCS_AUTHORIZATION_PLUGIN_MODULE=@fenix/openfga-authorization-plugin
RCS_OPENFGA_API_URL=http://localhost:8080
RCS_OPENFGA_STORE_ID=<store-id>
RCS_OPENFGA_MODEL_ID=<authorization-model-id>
```

## OpenFGA 插件 Demo

| 角色 | 动作 | 结果 |
| --- | --- | --- |
| `user:admin`（Skill Space resource_admin） | `skill:edit/share/use` | 全部允许 |
| `user:alice`（产品部成员） | `skill:edit/share/use` | 全部允许 |
| `user:bob`（开发部成员） | `skill:edit` | 允许 |
| `user:bob`（开发部成员） | `skill:share/use` | 拒绝 |
| 删除产品部 `shared_with` 后的 `user:alice` | `skill:use` | 拒绝，edit 仍允许 |

业务服务调用 Core 的 `requireAuthorization()`，仅传递 `subject`、领域 `action` 和 `resource`。授权端口的 `check()` 只返回布尔值；拒绝由服务层统一转换为 `403 FORBIDDEN`。OpenFGA 插件内部将请求转换为 `user:{id}`、`{resourceKind}:{id}` 与 `can_*` 关系的 `Check` 请求。默认 mapper 仅允许主体与资源属于同一组织；OpenFGA 网络、超时、非 2xx 或关系未命中时均返回拒绝。

## 测试

```bash
bun test packages/openfga-authorization-plugin/src/__tests__/openfga-authorization-plugin.test.ts
bun run verify:openfga
```

- Demo 脚本会创建隔离 Store，发布 `model/authorization-model.json`，写入组织、部门、Skill Space 和 Skill 关系，验证三角色允许/拒绝、ListObjects 与撤权；
- 业务模块不得导入 OpenFGA SDK、HTTP 客户端或 tuple 字符串；
- 仅 `@fenix/openfga-authorization-plugin` 可以映射领域动作与 OpenFGA relation；
- 企业已有 OpenFGA 时，通过替换该插件的 `OpenFgaMapper` 与 Store/模型配置适配其对象、动作和关系命名，不修改业务模块；
- 客户 mapper 如需支持跨组织协作，必须自行验证组织关系并补齐隔离测试；
- 未配置 `RCS_AUTHORIZATION_PLUGIN_MODULE` 时，Core 授权端口维持社区版既有权限行为。

## 运行日志

默认 `LOG_LEVEL=info` 时，可使用以下日志确认鉴权是否已进入 OpenFGA：

- `Authorization plugin loaded`：进程启动时已成功加载指定授权插件模块；
- `OpenFGA authorization check completed`：本次鉴权实际调用了 OpenFGA，日志包含动作、资源类型和允许/拒绝结果；
- `OpenFGA authorization check skipped`：请求被默认 mapper 在本地拒绝，未调用 OpenFGA；
- `OpenFGA authorization request failed` 或 `OpenFGA authorization unavailable`：OpenFGA 非正常响应或不可用，插件会按最小权限原则拒绝。

上述日志不记录 Store ID、模型 ID、用户 ID、资源 ID、tuple 或连接凭据。
