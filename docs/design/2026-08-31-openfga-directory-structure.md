# FenixAgent OpenFGA 授权目录与运行结构

> 本文描述当前企业授权接入的目录、职责边界和运行依赖。Store ID、模型 ID、数据库连接信息等敏感配置不在本文记录。

## 1. 结构总览

```text
FenixAgent/
├─ src/                                      # 社区版 Core
│  ├─ index.ts                               # 启动时装配授权插件
│  ├─ env.ts                                 # 仅声明通用插件模块开关
│  ├─ services/
│  │  ├─ authorization-gateway.ts            # 统一授权门面
│  │  ├─ authorization-plugin-loader.ts      # 动态加载企业授权插件
│  │  └─ resource-permission.ts              # Skill 公开权限检查接入点
│  └─ __tests__/authorization-foundation.test.ts
├─ packages/
│  ├─ authorization-plugin/                  # 稳定、引擎无关的授权契约
│  └─ openfga-authorization-plugin/          # OpenFGA 企业实现
│     ├─ src/index.ts                         # 动作映射、Check、失败策略
│     ├─ src/__tests__/                       # 插件测试
│     └─ model/authorization-model.{fga,json}# 授权模型源文件和发布载荷
├─ scripts/openfga-*-demo.ts                  # 本地演示与验证脚本
└─ docker-compose.enterprise-demo.yml         # OpenFGA 与外围依赖的本地编排
```

Core 不导入 OpenFGA SDK，不读取 Store、模型 ID，不构造 relation 或 tuple。业务模块仅传递业务动作，例如 `skill:share`。

## 2. 调用边界

```text
业务服务 / Route
  → requireAuthorization({ subject, action, resource })
  → src/services/authorization-gateway.ts
  → @fenix/authorization-plugin
  → @fenix/openfga-authorization-plugin
  → OpenFGA POST /stores/{storeId}/check
```

| 层级 | 负责内容 | 不负责内容 |
| --- | --- | --- |
| 业务模块 | 提供用户、业务动作、资源与组织上下文；拒绝后停止写入。 | OpenFGA 关系、tuple、模型和 HTTP 请求。 |
| Core 授权门面 | 将认证上下文转为主体，调用稳定契约并统一转换为 403。 | 策略计算和具体授权引擎。 |
| 授权契约包 | 定义 Subject、Resource 和 `check()` 接口。 | 引擎实现。 |
| OpenFGA 插件 | 业务动作映射、同组织校验、超时/异常拒绝、OpenFGA Check。 | 业务事务、资源状态机。 |
| OpenFGA | 依据模型与关系数据计算允许或拒绝。 | 业务数据和审批流程。 |

## 3. 当前 Skill 共享授权路径

```text
setPublicRead(...)
  → requireAuthorization(action = "skill:share")
  → 插件映射为 skill#can_share
  → OpenFGA Check
  → 允许：更新 PostgreSQL resource_permission
  → 拒绝：返回 HTTP 403，不更新公开权限
```

插件先比较主体与资源的 `organizationId`；不一致时在请求 OpenFGA 前拒绝，以避免跨组织放行。

当前组织 `owner` / `admin` 的 `skill:share` 权限会作为 OpenFGA **contextual tuple** 参与 Check，例如：

```text
skill:{skillId}#organization@organization:{organizationId}
organization:{organizationId}#org_admin@user:{userId}
```

OpenFGA 仍根据模型计算 `can_share`，Core 不直接通过 `ctx.role` 放行。该机制是关系持久同步完成前的过渡方案；长期应由 Outbox 将组织角色、Skill 归属等关系同步为持久 tuple，再移除此上下文关系。

## 4. 模型重点

当前模型主要包含：

```text
organization: org_owner / org_admin / member / auditor
department:   member / resource_admin
skill_space:  member / resource_admin / reviewer
skill:        organization / department / space / owner / creator /
              resource_admin / collaborator / shared_with / editor / sharer /
              can_read / can_use / can_edit / can_review / can_publish /
              can_share / can_delete
```

`can_*` 是 OpenFGA 模型内部的计算关系。业务代码不应依赖它们，而应保持 `skill:share`、`skill:edit` 等业务动作。

## 5. Docker 运行依赖

```text
openfga-postgres
  → openfga-migrate（初始化完成后退出属正常状态）
  → openfga（HTTP 8080；gRPC 8082）
  → FenixAgent 后端
```

健康检查：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8080/healthz" -Method Get
```

预期返回：

```json
{ "status": "SERVING" }
```

## 6. 配置与回退

| 状态 | 行为 |
| --- | --- |
| 未设置 `RCS_AUTHORIZATION_PLUGIN_MODULE` | 不加载企业插件，不访问 OpenFGA，社区版既有逻辑继续工作。 |
| 设置为 OpenFGA 插件模块 | 启动时加载插件，已接入动作经 OpenFGA Check。 |
| 插件配置错误或加载失败 | 后端拒绝启动，避免运行在不确定授权状态。 |
| OpenFGA 不可用、超时、模型错误或动作未映射 | fail-closed，受保护操作返回 403。 |

OpenFGA API 地址、Store ID 与模型 ID 仅由 OpenFGA 插件读取。更新模型 ID 或模型配置后，必须重启后端，运行中的进程才会加载新配置。

## 7. 验证入口

```powershell
bun test packages/openfga-authorization-plugin/src/__tests__/openfga-authorization-plugin.test.ts src/__tests__/authorization-foundation.test.ts
bunx tsc -p packages/openfga-authorization-plugin/tsconfig.json --noEmit
Invoke-RestMethod -Uri "http://127.0.0.1:8080/healthz" -Method Get
```
