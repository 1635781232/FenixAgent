import type {
  AppPrincipal,
  AuthorizationPolicy,
  AuthorizedExecutionContext,
  ResourceOperation,
} from "@fenix/plugin-sdk";

/** 统一授权明确拒绝业务操作时抛出的稳定错误。 */
export class AuthorizationDeniedError extends Error {
  readonly statusCode = 403;
  readonly reason: string;

  constructor(reason: string) {
    super(`Authorization denied: ${reason}`);
    this.name = "AuthorizationDeniedError";
    this.reason = reason;
  }
}

/**
 * App 层统一授权拦截器。
 *
 * 它只编排策略决策和安全执行上下文，不感知 OpenFGA、角色或业务资源实现。
 */
export class AuthorizedOperationExecutor {
  constructor(private readonly policy: AuthorizationPolicy) {}

  /** 执行仅需布尔结果的单资源鉴权，供界面能力检查等非业务执行场景复用。 */
  async check(principal: AppPrincipal, operation: ResourceOperation): Promise<boolean> {
    const decision = await this.policy.authorize(principal, operation);
    return decision.result !== "deny";
  }

  async run<T>(
    principal: AppPrincipal,
    operation: ResourceOperation,
    execute: (context: AuthorizedExecutionContext) => Promise<T>,
  ): Promise<T> {
    const decision = await this.policy.authorize(principal, operation);

    if (decision.result === "deny") throw new AuthorizationDeniedError(decision.reason);

    return execute({
      selector: decision.result === "allow-filtered" ? decision.selector : {},
      createScopeTags: decision.createScopeTags,
    });
  }
}
