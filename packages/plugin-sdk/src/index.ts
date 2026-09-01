/** 一个跨包稳定能力的类型化标识。 */
export interface Contract<T> {
  readonly id: string;
  readonly version: number;
  readonly __valueType?: T;
}

export {
  type AccessDecision,
  type AppPrincipal,
  type AuthorizationPolicy,
  type AuthorizedExecutionContext,
  type ResourceOperation,
  type ResourceSelector,
} from "./authorization";

import type { AuthorizationPolicy } from "./authorization";

/** 所有发行版共用的授权策略契约标识。 */
export const AUTHORIZATION_POLICY = defineContract<AuthorizationPolicy>("app.authorization-policy", 1);

/** 定义契约，不创建实现或全局状态。 */
export function defineContract<T>(id: string, version: number): Contract<T> {
  if (!id.trim()) throw new Error("Contract id must not be empty");
  if (!Number.isInteger(version) || version < 1) throw new Error("Contract version must be a positive integer");
  return Object.freeze({ id, version });
}

/** 插件依赖是构建期已安装插件的 ID，不涉及动态下载或目录扫描。 */
export interface PluginManifest {
  readonly id: string;
  readonly version: string;
  readonly requires?: readonly string[];
}

export interface ContractReplacement<T> {
  readonly replacementId: string;
  readonly replacesProvider: string;
  readonly reason: string;
  readonly value: T;
}

/** App Platform 向插件暴露的最小契约端口。 */
export interface ContractRegistryPort {
  bind<T>(contract: Contract<T>, providerId: string, value: T): void;
  replace<T>(contract: Contract<T>, replacement: ContractReplacement<T>): void;
  resolve<T>(contract: Contract<T>): T;
  providerId<T>(contract: Contract<T>): string | undefined;
}

export interface PluginContext {
  readonly contracts: ContractRegistryPort;
}

/** V4 架构验证所需的最小服务端插件。 */
export interface FenixPlugin {
  readonly manifest: PluginManifest;
  register(context: PluginContext): void | Promise<void>;
}
