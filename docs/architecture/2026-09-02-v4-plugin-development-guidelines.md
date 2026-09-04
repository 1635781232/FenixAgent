# FenixAgent V4 插件开发简易规范

> 本规范用于约束 Community、Enterprise 与 Customer 的插件开发和应用装配。架构背景以 `2026-08-13-open-core-commercial-customization-v4-review.html` 为准。

## 1. 总体原则

1. Community 必须是可独立部署、具备基础业务能力的完整产品，不得成为仅供 Enterprise 使用的空壳。
2. Enterprise 和 Customer 的差异能力必须通过独立插件包显式装配，不得直接覆盖 Community 源文件。
3. Core 可以为后续插件扩展新增或演进公开契约，但不得包含 Enterprise、Customer、角色、部门或 OpenFGA 等具体实现语义。
4. 插件安装表示在发行版构建和启动时装配插件包；当前不支持插件市场、运行时下载或热插拔。
5. Community、Enterprise 和 Customer 使用同一套 Core 领域实现；发行版差异应位于应用服务、策略、页面、任务和其他插件扩展层。

## 2. 依赖层级

```text
                    @fenix/plugin-sdk
                    /                \
                   /                  \
          @fenix/core          @fenix/app-platform
               \                    /
                \                  /
              @fenix/community-app-kit
                         |
             Community / Enterprise App
                         |
                 Enterprise Plugins
```

依赖规则：

- `@fenix/plugin-sdk` 提供 `Contract<T>`、插件清单、贡献类型和公共基础类型，不承载具体业务实现。
- `@fenix/core` 和 `@fenix/app-platform` 是平级包，二者都依赖 `@fenix/plugin-sdk`，彼此不得直接依赖。
- `@fenix/core` 定义 Skill、Agent、Model 等领域契约，并提供默认领域实现。
- `@fenix/app-platform` 实现 Contract Registry、Plugin Host、应用装配以及 `bind/decorate/replace`。
- `@fenix/community-app-kit` 同时使用 Core 和 App Platform，注册 Community 默认应用服务、路由、页面和 Provider。
- Enterprise 插件只能依赖公开契约，不得引用 Core、Community 或其他插件的内部文件。

## 3. 契约归属

契约应由最了解该语义的包定义，不能把所有业务接口都堆入 Plugin SDK。

| 契约类型 | 所属包 | 示例 |
|---|---|---|
| 通用契约机制 | `@fenix/plugin-sdk` | `Contract<T>`、`defineContract()`、`FenixPlugin` |
| 无身份的领域能力 | `@fenix/core` | `SKILL_RESOURCE_SERVICE`、`MODEL_SERVICE` |
| Community 产品应用能力 | `@fenix/community-app-kit` | `SKILL_APPLICATION`、组织应用服务 |
| 通用应用运行能力 | `@fenix/app-platform` | `AUTHORIZATION_POLICY`、授权执行器、贡献注册表 |
| 企业独有能力 | 对应 Enterprise 插件 | MCP、审核、配额等独有契约 |

定义契约时必须满足：

- 契约 ID 全局唯一且长期稳定。
- 契约只暴露必要 DTO、错误类型和行为，不暴露内部 Repository 或实现类。
- 对契约进行破坏性修改时必须升级契约版本，并提供迁移说明。
- Core 契约不得出现 `user`、`role`、`department`、`can_*`、OpenFGA Store 或 Model ID。

## 4. Core 开发规范

Core 可以修改，但修改必须保持领域中立和发行版无关。

Core 可以提供：

- Skill、Agent、Model 等领域 Service 契约；
- 公开 DTO、稳定错误类型和领域事件；
- `ids + scopeTags` 查询、更新和删除约束；
- 事务、Outbox 和幂等处理所需的通用扩展点；
- Community 与企业插件都可使用的通用领域能力。

Core 禁止包含：

- Community、Enterprise 或 Customer 发行版判断；
- 用户、组织、部门、角色和权限决策；
- `skill:edit`、`can_edit`、Tuple 等授权语义；
- OpenFGA、Casbin 或其他权限引擎实现；
- 插件扫描、插件加载和 Provider 替换逻辑；
- 企业审核、配额或客户定制流程。

Core 接收 App 层计算完成的资源范围，并在最终数据操作中强制执行：

```ts
interface SkillResourceService {
  list(query: SkillQuery, selector: ResourceSelector): Promise<readonly Skill[]>;
  update(skillId: string, input: UpdateSkillInput, selector: ResourceSelector): Promise<Skill>;
  delete(skillId: string, selector: ResourceSelector): Promise<void>;
}
```

不得先按 selector 查询资源，再绕过 selector 无条件更新或删除。

## 5. 插件扩展方式

插件必须根据业务差异选择明确的扩展方式：

| 方式 | 用途 | 示例 |
|---|---|---|
| `contribute` | 增加 Community 不存在的独立能力 | MCP 路由、页面、任务和迁移 |
| `decorate` | 在默认能力前后增加规则 | 配额、审计、指标、重试 |
| `replace` | 默认行为与企业行为语义明显不同 | 企业 Skill 应用服务、OpenFGA 权限策略、企业身份实现 |

使用 `replace` 时必须：

1. 指定稳定契约；
2. 指定被替换的 Provider ID；
3. 说明替换原因；
4. 在 Enterprise App 中声明最终必需 Provider；
5. 被替换 Provider 不存在、存在多个替换者或最终 Provider 缺失时启动失败。

禁止通过注册顺序静默覆盖 Provider。

## 6. 企业业务插件规范

企业业务插件应独立打包，例如：

```text
@fenix-enterprise/openfga-authorization-plugin
@fenix-enterprise/skill-plugin
@fenix-enterprise/mcp-plugin
@fenix-enterprise/audit-plugin
```

每个插件可以包含自己的：

- Application Service；
- 后端 Route；
- 前端 Route、页面、导航和插槽贡献；
- 数据表与迁移；
- 后台任务；
- 业务事件；
- 权限编码；
- 自动化测试。

插件不得：

- 复制 Core 的完整领域实现；
- 修改其他包或插件拥有的数据表；
- 直接导入其他插件的内部实现；
- 通过环境变量判断并修改 Community 代码路径；
- 直接覆盖 Community 文件或使用构建脚本替换源码。

Enterprise Skill 插件应复用 Core Skill Service，只替换或装饰应用层流程：

```text
Enterprise Skill Application
        ↓
AuthorizationPolicy
        ↓ ids + scopeTags
Core Skill Resource Service
```

## 7. 权限插件规范

权限插件与 Skill、MCP 等业务插件必须分离。

- 业务插件使用 `skill:edit`、`skill:use`、`mcp:use` 等稳定业务权限编码。
- OpenFGA 插件负责把业务权限编码映射为 `can_edit`、`can_use` 等关系。
- 业务插件不得直接调用 OpenFGA Client，不得构造 Tuple，不得读取 Store ID 或授权模型 ID。
- 权限插件不得实现 Skill、MCP 等业务流程。
- 企业业务插件应依赖 `AuthorizationPolicy` 能力，而不是依赖具体 OpenFGA 插件 ID。
- Enterprise 发行版必须要求企业权限 Provider 存在；插件漏装或初始化失败时禁止回退到 Community 默认策略。

调用边界：

```text
Enterprise Skill / MCP Plugin
        ↓ 业务动作和资源 ID
AuthorizationPolicy
        ↓
OpenFGA Authorization Plugin
        ↓ relation / object / tuple
OpenFGA
```

当前用户 ID 必须来自服务端可信认证上下文。前端只能提交资源 ID 和业务数据，不能决定鉴权主体或权限动作。

## 8. 前后端与数据规范

- 前端权限仅用于控制按钮、菜单和页面展示，后端必须再次强制鉴权。
- Community 和 Enterprise 应优先共用基础页面；企业功能可通过 Slot、独立 Route 或显式 Page Replacement 扩展。
- 页面语义完全不同才允许完整替换，不得仅因增加一个按钮复制整页。
- Core 拥有基础资源数据；Community App Kit 拥有用户、Session、组织等 Community 数据；每个企业插件拥有自己的扩展表和迁移。
- 企业字段优先保存在插件扩展表，通过资源 ID 与 Core 数据逻辑关联，不得随意修改 Core 表。
- 跨插件数据同步必须考虑 Outbox、幂等、重试、补偿和对账，不得依赖不可恢复的隐式跨层事务。

## 9. 发行版装配规范

Community App：

```ts
registerCommunityBase(app);
```

Enterprise App：

```ts
registerCommunityBase(app);

app.registerPlugins([
  enterpriseOpenFgaAuthorizationPlugin,
  enterpriseSkillPlugin,
  enterpriseMcpPlugin,
  enterpriseAuditPlugin,
]);

app.requireProvider(AUTHORIZATION_POLICY, "enterprise.authorization.openfga");
app.requireProvider(SKILL_APPLICATION, "enterprise.skill.application");
```

发行版由装配的插件包决定，不得使用 `EDITION=enterprise` 等参数在同一段代码中切换实现。OpenFGA 地址、Store ID 等配置只配置已经装配的权限插件，不用于选择发行版。

## 10. 开发检查清单

新增或修改插件时必须确认：

- [ ] 契约归属正确，没有把具体业务契约放入 Plugin SDK。
- [ ] Core 修改保持领域中立，没有引入身份、权限或企业语义。
- [ ] 插件只依赖公开契约，没有引用内部文件。
- [ ] 已明确使用 `contribute`、`decorate` 或 `replace`。
- [ ] 替换操作声明了目标 Provider、原因和最终必需 Provider。
- [ ] Community 缺少企业插件时仍可独立运行。
- [ ] Enterprise 缺少必需插件时启动失败，不回退到 Community 实现。
- [ ] 后端执行真实鉴权，前端隐藏按钮不是唯一控制。
- [ ] Core 最终数据操作强制使用 `ids + scopeTags`。
- [ ] 插件数据、迁移、任务和事件具有明确所有者。
- [ ] 没有复制 Core 或 Community 的完整业务实现。
- [ ] 已覆盖 Community 默认行为、Enterprise 替换行为和插件缺失失败测试。

## 11. 一句话边界

```text
Plugin SDK 定义扩展语言；Core 定义通用领域契约；App Platform 执行插件装配；Community 提供默认产品；Enterprise 通过独立插件包新增、装饰或替换公开契约。
```
