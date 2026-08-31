import {
  type AuthorizationCheckInput,
  type AuthorizationSubject,
  authorizationGateway,
} from "@fenix/authorization-plugin";
import { AppError } from "../errors";
import type { AuthContext } from "../plugins/auth";

/**
 * 将当前认证上下文转换为授权领域主体。
 *
 * 认证字段变化仅在此处适配。组织角色是已认证的业务事实，只有企业插件在相应动作中需要
 * 组织治理能力时才会使用；Core 不感知 OpenFGA 的 relation 或 tuple。
 */
export function authorizationSubjectFromAuthContext(ctx: AuthContext): AuthorizationSubject {
  return {
    kind: "user",
    id: ctx.userId,
    organizationId: ctx.organizationId,
    organizationRole: ctx.role,
  };
}

/**
 * Core 的统一授权入口。
 *
 * 该函数只依赖产品无关的授权端口；Store、relation、网络调用和外部引擎错误细节均由插件处理。
 */
export async function requireAuthorization(input: AuthorizationCheckInput): Promise<void> {
  if (!(await authorizationGateway.check(input))) {
    throw new AppError(`Permission denied: ${input.action} ${input.resource.kind}`, "FORBIDDEN", 403);
  }
}
