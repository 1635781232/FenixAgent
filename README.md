# FenixAgent V4 纯架构验证脚手架

该仓库分支是从零搭建的独立 Bun workspace，用于验证 V4 包关系、契约注册、插件依赖排序和发行版装配。

它不包含旧项目的 `src/`、数据库、OpenFGA、用户、组织、Agent 或任何现有业务代码。所有包直接使用目标架构中的正式 `@fenix/*` 命名。

## 依赖关系

```text
Community App
└─ @fenix/community-app-kit
   ├─ @fenix/core
   ├─ @fenix/app-platform
   └─ @fenix/plugin-sdk

Enterprise App
├─ @fenix/community-app-kit
├─ @fenix/core
├─ @fenix/app-platform
├─ @fenix/plugin-sdk
└─ Enterprise Plugins

@fenix/core ──────────┐
                      ├─ @fenix/plugin-sdk
@fenix/app-platform ──┘
```

## 目录

```text
./
├─ packages/
│  ├─ plugin-sdk/          # Contract、Manifest、Plugin 公共类型
│  ├─ core/                # 无业务的 Core Facade 占位契约
│  ├─ app-platform/        # ContractRegistry、PluginHost、App Builder
│  └─ community-app-kit/   # registerCommunityBase()
├─ plugins/
│  └─ enterprise-profile/  # 仅验证 Provider 替换的企业插件
├─ apps/
│  ├─ community-app/       # Community 显式装配入口
│  └─ enterprise-app/      # Community Base + Enterprise Plugins
└─ tests/                  # 纯架构行为测试
```

`DistributionProfile` 只是一项无业务含义的验证契约：Community 注册默认 Provider，Enterprise 插件显式替换它。它不代表未来必须存在该产品能力。

## 验证

在仓库根目录执行：

```powershell
bun install
bun run test
bun run typecheck
bun run build
```

## 非目标

- 不迁移现有业务代码；
- 不实现授权、身份、审计或配额；
- 不连接 OpenFGA 或数据库；
- 不提供 HTTP Route 或前端页面；
- 不修改当前 Community 服务启动入口；
- 不证明现有 `@fenix/core` 已符合 V4 边界。

验证通过后，应选择一个真实但足够小的纵向用例，再决定哪些接口需要进入正式 Plugin SDK 和 App Platform。
