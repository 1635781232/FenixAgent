# CLAUDE.md

## 项目定位

当前分支是 FenixAgent V4 的架构验证工程，用于从零验证包边界、公开契约、插件装配和 Community / Enterprise 发行版关系。当前包含一个内存型 Skill 纵向用例，以及 Enterprise OpenFGA 基础设施接入和统一授权拦截器。

本分支不迁移现有业务，不接入数据库、Agent、用户或组织能力。OpenFGA 仅验证平台包、Enterprise Policy Provider、`Check` / `ListObjects` 和 `ids + scopeTags` 输出，不修改 Skill 业务服务、HTTP 路由或页面；后续新增业务授权前应先确认动作映射、可信 Scope Tags 来源和关系投影契约。

## 目标依赖关系

```text
Community App
└─ @fenix/community-app-kit
   ├─ @fenix/core
   ├─ @fenix/app-platform
   └─ @fenix/plugin-sdk

Enterprise App
├─ @fenix/community-app-kit
├─ @fenix/app-platform
├─ @fenix/core 的公开契约
└─ Enterprise Plugins

@fenix/core ──────────┐
                      ├─ @fenix/plugin-sdk
@fenix/app-platform ──┘
```

## 架构约束

1. `@fenix/plugin-sdk` 只定义跨包公开契约和插件类型，不包含实现或全局状态。
2. `@fenix/core` 只依赖 `@fenix/plugin-sdk`，不得依赖 App、Community Kit 或企业插件。
3. `@fenix/app-platform` 只负责契约注册、插件生命周期和应用装配，不承载领域业务。
4. `@fenix/community-app-kit` 注册 Community 固定基础能力，不伪装成可卸载插件。
5. Community App 只显式装配 Community Base；Enterprise App 复用 Community Base，并显式装配企业插件。
6. 插件只依赖公开契约，不得反向依赖 App 入口或其他包的内部文件。
7. 插件清单必须由发行版显式传入；不得扫描目录、运行时下载或依赖隐式注册副作用。
8. Enterprise 替换 Community Provider 时必须声明被替换 Provider、替换原因和必需 Provider，替换缺失时启动失败。
9. Enterprise 以 OpenFGA 为唯一权限决策来源；统一授权拦截器属于 App Platform，OpenFGA Client 与关系名不得进入 Core 或业务模块。

## 编码规范

- 使用 TypeScript strict 模式，禁止 `as any`。
- 文件使用 kebab-case，函数使用 camelCase，类型和类使用 PascalCase，常量使用 UPPER_SNAKE_CASE。
- 公共类型、函数和类必须有中文文档注释；注释解释边界和设计原因，不重复代码表面行为。
- 单个文件不得超过 500 行；只为当前验证目标编写最小实现，不做推测性抽象。
- 错误必须保留足够上下文，不得吞错。
- 测试名称和每个 `test(...)` 上方的业务意图注释使用中文。

## 验证

完成改动后依次运行：

```powershell
bun run test
bun run typecheck
bun run build
```

三项必须全部通过。不得为通过检查而修改与当前需求无关的文件。

## Git

- 未经用户明确要求不得创建 commit。
- 提交信息使用 Angular 风格，标题使用中文，例如 `feat: 搭建 V4 插件装配框架`。
