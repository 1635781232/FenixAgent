# Skill 列表、权限过滤与编辑按钮场景

## 1. 文档目的

本文基于同目录下的 `authorization-model.fga` 和 `authorization-model.json`，演示以下完整流程：

1. 列出当前用户所有能够使用的 Skill；
2. 将 OpenFGA 返回的资源 IDs 与可信 `scopeTags` 一起传给 Core 过滤；
3. 用户选中一个 Skill 并尝试编辑；
4. 前端通过后端检查编辑权限，无权限时隐藏编辑按钮；
5. 后端编辑接口仍然重新强制鉴权，不能依赖前端隐藏按钮。

本文只描述预期接入方式和测试数据，不表示当前 Skill 业务代码已经完成接入。

## 2. 当前模型中与场景相关的权限

当前 `skill` 类型的关键计算关系如下：

| 直接或间接关系 | `can_read` | `can_use` | `can_edit` | `can_publish` | `can_share` |
|---|---:|---:|---:|---:|---:|
| `owner` | ✓ | ✓ | ✓ | ✗ | ✓ |
| `creator` | ✓ | ✗ | ✗ | ✗ | ✗ |
| Skill `resource_admin` | ✓ | ✓ | ✓ | ✗ | ✓ |
| `collaborator` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `shared_with` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `editor` | ✓ | ✗ | ✓ | ✗ | ✗ |
| `sharer` | ✗ | ✗ | ✗ | ✗ | ✓ |
| Skill Space `resource_admin` | ✓ | ✓ | ✓ | ✓ | ✓ |
| Skill Space `member` | ✓ | ✗ | ✗ | ✗ | ✗ |
| Skill Space `reviewer` | ✓ | ✗ | ✗ | ✓ | ✗ |

需要特别注意：

- “能查看”不等于“能使用”；列出当前用户所有能用的 Skill 必须查询 `can_use`，不能查询 `can_read`；
- `creator` 当前只具有 `can_read`，如果产品预期创建人拥有完整管理权，创建时还必须写入 `owner`，或者修改模型；
- `editor` 当前可以编辑但不能使用，因此一个 Skill 可能出现在“可编辑列表”中，却不出现在“可使用列表”中；
- `skill.department` 当前没有参与任何 `can_*` 计算，仅写入该关系不会产生权限；
- 前端按钮检查只是体验优化，后端必须继续执行强制鉴权。

## 3. 测试主体与资源

当前登录用户设为 Bob：

```text
当前用户：user:bob
当前租户：tenant-a
所属部门：department:development
```

准备以下 Skill：

| Skill | 名称 | Bob 的来源关系 | 预期结果 |
|---|---|---|---|
| `skill:meeting-notes` | 会议纪要助手 | 开发部成员通过 `shared_with` 获得权限 | 可查看、可使用，不可编辑 |
| `skill:dev-helper` | 开发辅助助手 | Bob 是所属 Skill Space 的 `resource_admin` | 可查看、可使用、可编辑、可发布、可共享 |
| `skill:api-review` | API 审核助手 | 开发部成员通过 `editor` 获得权限 | 可查看、可编辑，但不可使用 |
| `skill:read-only-guide` | 只读规范助手 | Bob 是 `collaborator` | 仅可查看，不可使用和编辑 |
| `skill:finance-secret` | 财务分析助手 | 无关联关系 | 不可查看、使用或编辑 |

Core 中所有这些资源均属于同一可信租户范围：

```ts
{
  "enterprise.tenant": "tenant-a",
}
```

部门共享由 OpenFGA 关系表达，不应把 `enterprise.department=development` 当成唯一的 Core 隔离范围，否则跨部门共享资源可能被数据库范围过滤错误排除。

## 4. OpenFGA 测试 Tuple

以下使用 OpenFGA 的 `object#relation@user` 可读格式展示，实际写入 API 时拆分为 `object`、`relation`、`user` 三个字段。

### 4.1 组织、部门与空间关系

```text
department:development#organization@organization:tenant-a
department:development#member@user:bob

skill_space:product-space#organization@organization:tenant-a
skill_space:dev-space#organization@organization:tenant-a
skill_space:dev-space#resource_admin@user:bob
```

### 4.2 Skill 基础关系

```text
skill:meeting-notes#organization@organization:tenant-a
skill:meeting-notes#space@skill_space:product-space
skill:meeting-notes#owner@user:alice
skill:meeting-notes#creator@user:alice
skill:meeting-notes#shared_with@department:development#member

skill:dev-helper#organization@organization:tenant-a
skill:dev-helper#space@skill_space:dev-space
skill:dev-helper#owner@user:alice

skill:api-review#organization@organization:tenant-a
skill:api-review#space@skill_space:product-space
skill:api-review#editor@department:development#member

skill:read-only-guide#organization@organization:tenant-a
skill:read-only-guide#space@skill_space:product-space
skill:read-only-guide#collaborator@user:bob

skill:finance-secret#organization@organization:tenant-a
skill:finance-secret#space@skill_space:product-space
skill:finance-secret#owner@user:carol
```

## 5. 场景一：列出 Bob 所有能使用的 Skill

### 5.1 前端请求

前端只请求“我的可用 Skill”，不直接传入可信权限结果：

```http
GET /api/skills?view=usable
```

前端不能自行构造以下内容作为可信条件：

```ts
// 禁止直接信任前端传入的 selector。
{
  ids: ["meeting-notes"],
  scopeTags: { "enterprise.tenant": "tenant-a" },
}
```

后端应从 Session 得到 `user:bob`，从可信租户上下文得到 `tenant-a`。

### 5.2 后端构造授权操作

```ts
const operation = {
  resourceType: "skill",
  action: "skill:list-usable",
  scopeTags: {
    "enterprise.tenant": "tenant-a",
  },
};
```

Enterprise 的动作映射：

```ts
const actionRelations = {
  "skill:list-usable": "can_use",
  "skill:edit": "can_edit",
};
```

### 5.3 OpenFGA ListObjects

后端 Enterprise Policy 调用：

```http
POST /stores/{storeId}/list-objects
Content-Type: application/json
```

```json
{
  "authorization_model_id": "{authorizationModelId}",
  "type": "skill",
  "relation": "can_use",
  "user": "user:bob"
}
```

根据当前模型和测试 Tuple，预期返回：

```json
{
  "objects": [
    "skill:meeting-notes",
    "skill:dev-helper"
  ]
}
```

以下 Skill 不应返回：

| Skill | 不返回原因 |
|---|---|
| `skill:api-review` | `editor` 只提供 `can_read + can_edit`，不提供 `can_use` |
| `skill:read-only-guide` | `collaborator` 只提供 `can_read` |
| `skill:finance-secret` | Bob 与资源之间不存在允许关系 |

## 6. 场景二：按照权限结果过滤 Core 数据

Enterprise Policy 将 OpenFGA 的对象列表转换为统一的 `AccessDecision`：

```ts
{
  result: "allow-filtered",
  selector: {
    ids: ["meeting-notes", "dev-helper"],
    scopeTags: {
      "enterprise.tenant": "tenant-a",
    },
  },
}
```

`AuthorizedOperationExecutor` 把 selector 传给 Core。Core 不解释 Bob、部门或 OpenFGA，只执行最终过滤：

```sql
SELECT *
FROM skills
WHERE id IN ('meeting-notes', 'dev-helper')
  AND scope_tags @> '{"enterprise.tenant":"tenant-a"}'
ORDER BY updated_at DESC;
```

完整链路：

```text
前端 GET /api/skills?view=usable
  → 后端从 Session 得到 user:bob
  → Enterprise Policy 调用 ListObjects(can_use)
  → AccessDecision { ids + scopeTags }
  → AuthorizedOperationExecutor
  → Core Repository 执行 ids 与 scopeTags 交集查询
  → 返回“会议纪要助手”和“开发辅助助手”
```

这不是两次鉴权：OpenFGA 负责一次权限决策，Core 只负责执行授权结果限定的数据查询。

## 7. 场景三：Bob 选中“会议纪要助手”

用户从可用列表中选中：

```text
skill:meeting-notes
```

“出现在可用列表”只证明 Bob 具有 `can_use`，不能推导 Bob 同时具有 `can_edit`。前端需要通过后端查询该资源的操作能力。

推荐接口：

```http
GET /api/skills/meeting-notes/capabilities
```

后端可以返回页面真正需要的能力：

```json
{
  "canUse": true,
  "canEdit": false,
  "canPublish": false,
  "canShare": false
}
```

前端不应直接连接 OpenFGA，也不应知道 Store ID、模型 ID或 `can_edit` 的模型实现细节。

## 8. 场景四：前端检查编辑权限并隐藏按钮

### 8.1 后端执行 Check

后端把产品动作 `skill:edit` 映射为模型关系 `can_edit`，调用：

```http
POST /stores/{storeId}/check
Content-Type: application/json
```

```json
{
  "authorization_model_id": "{authorizationModelId}",
  "tuple_key": {
    "user": "user:bob",
    "relation": "can_edit",
    "object": "skill:meeting-notes"
  }
}
```

因为 Bob 仅通过 `shared_with@department:development#member` 获得权限，而 `shared_with` 不参与 `can_edit`，预期结果为：

```json
{
  "allowed": false
}
```

### 8.2 前端显示逻辑

```ts
const capabilities = await skillApi.getCapabilities("meeting-notes");

if (capabilities.canEdit) {
  showEditButton();
} else {
  hideEditButton();
}
```

页面预期：

```text
会议纪要助手
[运行]  [查看详情]

“编辑”按钮不显示
“发布”按钮不显示
“共享”按钮不显示
```

### 8.3 后端仍须强制鉴权

隐藏按钮不能代替后端鉴权。Bob 仍可能手工构造请求：

```http
PUT /api/skills/meeting-notes
Content-Type: application/json

{
  "name": "被篡改的名称"
}
```

编辑接口必须重新执行 `Check(can_edit)`。拒绝时 `AuthorizedOperationExecutor` 不调用 Core：

```text
PUT /api/skills/meeting-notes
  → AuthorizedOperationExecutor
  → Enterprise Policy
  → OpenFGA Check(can_edit) = false
  → 返回 403
  → Core Skill update 不执行
```

前端能力检查与后端写操作检查是两个独立请求，因此需要分别鉴权；不能复用前端保存的旧结果。

## 9. 对照场景：Bob 编辑“开发辅助助手”

Bob 是 `skill_space:dev-space` 的 `resource_admin`，而 `skill:dev-helper` 指向该空间：

```text
skill_space:dev-space#resource_admin@user:bob
skill:dev-helper#space@skill_space:dev-space
```

模型包含：

```text
can_edit = ... or resource_admin from space
```

所以检查结果为：

```json
{
  "allowed": true
}
```

前端显示编辑按钮；Bob 点击后，后端再次执行 `Check(can_edit)`，允许后向 Core 传递：

```ts
{
  ids: ["dev-helper"],
  scopeTags: {
    "enterprise.tenant": "tenant-a",
  },
}
```

Core Repository 只更新 ID 和可信租户范围同时匹配的记录。

## 10. 建议验证矩阵

| 用户/来源关系 | Skill | `can_read` | `can_use` | `can_edit` | 可用列表 | 编辑按钮 |
|---|---|---:|---:|---:|---:|---:|
| Bob / 开发部 `member` → `shared_with` | 会议纪要助手 | ✓ | ✓ | ✗ | 显示 | 隐藏 |
| Bob / Skill Space `resource_admin` | 开发辅助助手 | ✓ | ✓ | ✓ | 显示 | 显示 |
| Bob / 开发部 `member` → `editor` | API 审核助手 | ✓ | ✗ | ✓ | 不显示 | 直接访问详情时显示 |
| Bob / `collaborator` | 只读规范助手 | ✓ | ✗ | ✗ | 不显示 | 隐藏 |
| Bob / 无关系 | 财务分析助手 | ✗ | ✗ | ✗ | 不显示 | 隐藏 |

## 11. 验收条件

- `ListObjects(type=skill, relation=can_use, user=user:bob)` 只返回 `meeting-notes` 和 `dev-helper`；
- Core 查询同时应用 OpenFGA IDs 与可信租户 `scopeTags`；
- Bob 选择 `meeting-notes` 时能力接口返回 `canEdit=false`；
- 前端不显示 `meeting-notes` 的编辑按钮；
- Bob 手工调用编辑接口仍返回 403，Core 更新方法不执行；
- Bob 选择 `dev-helper` 时能力接口返回 `canEdit=true`；
- 未映射的产品动作默认拒绝；
- OpenFGA 请求失败时后端失败关闭，不回退到其他权限实现；
- 前端代码不直接调用 OpenFGA，也不持有 Store ID、模型 ID 或 API Token。
