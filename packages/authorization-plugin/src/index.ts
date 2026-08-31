/**
 * 授权边界中的业务主体。
 *
 * 主体的组织角色是可信认证上下文中的业务事实。它只在某项业务动作明确要求组织治理能力时
 * 作为授权决策输入；OpenFGA relation、tuple 和具体推导方式仍由企业插件决定。
 */
export interface AuthorizationSubject {
  kind: "user";
  id: string;
  organizationId: string;
  organizationRole: "owner" | "admin" | "member";
}

/**
 * 授权边界中的业务资源。
 *
 * `kind` 和 `id` 保持 FenixAgent 领域语义，OpenFGA 的 object 前缀及 relation 不得泄漏到 Core。
 */
export interface AuthorizationResource {
  kind: string;
  id: string;
  organizationId: string;
}

/** 单次授权判断所需的最小业务上下文。 */
export interface AuthorizationCheckInput {
  subject: AuthorizationSubject;
  action: string;
  resource: AuthorizationResource;
}

/**
 * FenixAgent Core 与授权插件之间的稳定扩展契约。
 *
 * 插件实现负责模型、Store、tuple 命名及外部调用；Core 只提交业务标识和动作。当前仅定义
 * 查询能力，关系写入必须在资源生命周期事件和 Outbox 方案确定后再增加，避免形成无调用方的抽象。
 */
export interface AuthorizationPlugin {
  check(input: AuthorizationCheckInput): Promise<boolean>;
}

/**
 * 授权插件模块的公开入口。
 *
 * Core 仅按此工厂加载外部实现，因此不需要依赖某个具体授权产品。工厂读取其自身需要的
 * 部署配置并创建插件；配置错误应抛出异常，阻止企业环境以未知权限状态启动。
 */
export interface AuthorizationPluginModule {
  createAuthorizationPlugin(): AuthorizationPlugin | Promise<AuthorizationPlugin>;
}

/** 社区版不配置外部授权服务，保持现有权限行为。 */
export const allowAllAuthorizationPlugin: AuthorizationPlugin = {
  check: async () => true,
};

/** 企业授权功能已启用但插件未配置时必须拒绝，避免部署错误扩大权限。 */
export const denyAllAuthorizationPlugin: AuthorizationPlugin = {
  check: async () => false,
};

let installedPlugin: AuthorizationPlugin = allowAllAuthorizationPlugin;
let hasInstalledExternalPlugin = false;

/**
 * 安装部署侧选定的授权插件。
 *
 * 启动阶段只允许安装一次，避免运行时替换导致同一进程内的请求使用不同策略；测试可在独立
 * 进程中验证不同实现，不应借由重装插件改变生产行为。
 */
export function installAuthorizationPlugin(plugin: AuthorizationPlugin): void {
  if (hasInstalledExternalPlugin) {
    throw new Error("Authorization plugin has already been installed for this process");
  }
  installedPlugin = plugin;
  hasInstalledExternalPlugin = true;
}

/**
 * Core 使用的授权端口。
 *
 * 它只转发领域请求，不保存 OpenFGA、策略或缓存信息。未安装企业插件时保留社区版的默认行为。
 */
export const authorizationGateway = {
  check(input: AuthorizationCheckInput): Promise<boolean> {
    return installedPlugin.check(input);
  },
};
