/** Core 用于执行最终数据过滤的稳定资源选择器。 */
export interface ResourceSelector {
  readonly ids?: readonly string[];
  readonly scopeTags?: Readonly<Record<string, string | readonly string[]>>;
}

/** 已认证主体的最小公开形态，身份属性由发行版解释。 */
export interface AppPrincipal {
  readonly id: string;
  readonly type?: string;
  readonly attributes?: Readonly<Record<string, string>>;
}

/** Application Service 传给统一授权管道的业务操作描述。 */
export interface ResourceOperation {
  readonly resourceType: string;
  readonly action: string;
  readonly resourceId?: string;
  readonly requestedIds?: readonly string[];
  readonly scopeTags?: Readonly<Record<string, string | readonly string[]>>;
}

/** 授权 Provider 的稳定输出，显式区分拒绝、全量允许和范围允许。 */
export type AccessDecision =
  | { readonly result: "deny"; readonly reason: string }
  | {
      readonly result: "allow-all";
      readonly createScopeTags?: Readonly<Record<string, string>>;
    }
  | {
      readonly result: "allow-filtered";
      readonly selector: ResourceSelector;
      readonly createScopeTags?: Readonly<Record<string, string>>;
    };

/** Community、Enterprise 或 Customer 必须实现的统一授权策略端口。 */
export interface AuthorizationPolicy {
  authorize(principal: AppPrincipal, operation: ResourceOperation): Promise<AccessDecision>;
}

/** 允许结果传给业务回调的安全执行上下文。 */
export interface AuthorizedExecutionContext {
  readonly selector: ResourceSelector;
  readonly createScopeTags?: Readonly<Record<string, string>>;
}
