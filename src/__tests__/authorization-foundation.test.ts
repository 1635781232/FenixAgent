import { describe, expect, test } from "bun:test";
import { authorizationGateway } from "@fenix/authorization-plugin";
import { authorizationSubjectFromAuthContext } from "../services/authorization-gateway";
import { initializeAuthorizationPlugin } from "../services/authorization-plugin-loader";

const ctx = {
  organizationId: "org_1",
  userId: "user_1",
  role: "admin" as const,
};

describe("授权端口基础能力", () => {
  // 未加载部署插件时维持社区版既有权限行为，不要求外部授权运行时存在。
  test("默认授权端口不依赖外部授权引擎", async () => {
    await expect(
      authorizationGateway.check({
        subject: { kind: "user", id: "user_1", organizationId: "org_1", organizationRole: "admin" },
        action: "skill:share",
        resource: { kind: "skill", id: "skill_1", organizationId: "org_1" },
      }),
    ).resolves.toBe(true);
  });

  // 配置为不符合契约的模块时启动必须失败，避免企业部署静默回退到默认放行。
  test("拒绝未导出授权插件工厂的模块", async () => {
    await expect(initializeAuthorizationPlugin("@fenix/authorization-plugin")).rejects.toThrow(
      "must export createAuthorizationPlugin()",
    );
  });

  // 认证上下文向授权端口传递可信组织角色，供企业插件在明确需要组织治理能力的动作中使用。
  test("从认证上下文构建授权主体", () => {
    expect(authorizationSubjectFromAuthContext(ctx)).toEqual({
      kind: "user",
      id: "user_1",
      organizationId: "org_1",
      organizationRole: "admin",
    });
  });
});
