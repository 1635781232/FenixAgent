import {
  type AuthorizationPlugin,
  type AuthorizationPluginModule,
  installAuthorizationPlugin,
} from "@fenix/authorization-plugin";
import { createLogger } from "@fenix/logger";

const logger = createLogger("authorization-plugin-loader");

/**
 * 在启动阶段加载部署侧指定的授权插件。
 *
 * Core 仅验证模块是否遵守授权插件契约，不 import 任一具体授权引擎。加载或初始化失败会阻止
 * 进程启动，避免企业环境因插件缺失而以社区版默认放行继续提供服务。
 */
export async function initializeAuthorizationPlugin(moduleName: string | undefined): Promise<void> {
  if (!moduleName) return;

  const module = (await import(moduleName)) as unknown;
  const pluginModule = toAuthorizationPluginModule(module, moduleName);
  const plugin = await pluginModule.createAuthorizationPlugin();
  if (!isAuthorizationPlugin(plugin)) {
    throw new Error(`Authorization plugin module ${moduleName} returned an invalid plugin`);
  }
  installAuthorizationPlugin(plugin);
  // 启动日志用于确认当前进程已切换至外部授权实现，不记录引擎配置或凭据。
  logger.info("Authorization plugin loaded", { moduleName });
}

/** 将动态导入结果收窄为稳定插件契约，防止部署配置指向任意不兼容模块。 */
function toAuthorizationPluginModule(module: unknown, moduleName: string): AuthorizationPluginModule {
  if (!isAuthorizationPluginModule(module)) {
    throw new Error(`Authorization plugin module ${moduleName} must export createAuthorizationPlugin()`);
  }
  return module;
}

/** 运行时守卫只检查模块公开工厂；工厂返回值在安装前继续验证。 */
function isAuthorizationPluginModule(value: unknown): value is AuthorizationPluginModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "createAuthorizationPlugin" in value &&
    typeof value.createAuthorizationPlugin === "function"
  );
}

/** 工厂结果必须提供 check 方法，避免配置错误模块被安装后在首个请求才暴露错误。 */
function isAuthorizationPlugin(value: unknown): value is AuthorizationPlugin {
  return typeof value === "object" && value !== null && "check" in value && typeof value.check === "function";
}
