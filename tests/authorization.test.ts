import { describe, expect, test } from "bun:test";
import {
  AuthorizationDeniedError,
  AuthorizedOperationExecutor,
} from "@fenix/app-platform";
import { OpenFgaClient, type OpenFgaFetch } from "@fenix/app-platform-openfga";
import {
  EnterpriseOpenFgaAuthorizationPolicy,
} from "@fenix-enterprise/openfga-authorization-plugin";
import type { AuthorizationPolicy } from "@fenix/plugin-sdk";

const OPENFGA_CONFIG = {
  apiUrl: "http://openfga.test/",
  storeId: "store/one",
  authorizationModelId: "model-one",
} as const;

describe("统一授权拦截器", () => {
  // 拒绝结果必须在业务回调执行前终止请求，避免 Core 被误调用。
  test("拒绝决策不会执行业务回调", async () => {
    let executed = false;
    const policy: AuthorizationPolicy = {
      authorize: async () => ({ result: "deny", reason: "test_denied" }),
    };
    const executor = new AuthorizedOperationExecutor(policy);

    await expect(
      executor.run(
        { id: "alice" },
        { resourceType: "skill", action: "skill:edit", resourceId: "skill-1" },
        async () => {
          executed = true;
        },
      ),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);

    expect(executed).toBeFalse();
  });

  // 允许结果的 ids 与 scopeTags 必须原样进入统一执行上下文。
  test("允许决策向业务回调传递统一 selector", async () => {
    const policy: AuthorizationPolicy = {
      authorize: async () => ({
        result: "allow-filtered",
        selector: {
          ids: ["skill-1"],
          scopeTags: { "enterprise.tenant": "tenant-a" },
        },
      }),
    };
    const executor = new AuthorizedOperationExecutor(policy);

    const selector = await executor.run(
      { id: "alice" },
      { resourceType: "skill", action: "skill:read", resourceId: "skill-1" },
      async (context) => context.selector,
    );

    expect(selector).toEqual({
      ids: ["skill-1"],
      scopeTags: { "enterprise.tenant": "tenant-a" },
    });
  });
});

describe("OpenFGA 平台接入", () => {
  // 客户端必须携带 Store、模型和 Tuple Key 调用官方 Check API。
  test("OpenFGA Check 使用显式 Store 和模型", async () => {
    let requestBody: unknown;
    let requestUrl = "";
    const fetcher: OpenFgaFetch = async (input, init) => {
      requestUrl = input instanceof Request ? input.url : String(input);
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return Response.json({ allowed: true });
    };
    const client = new OpenFgaClient(OPENFGA_CONFIG, fetcher);

    const allowed = await client.check({
      user: "user:alice",
      relation: "can_edit",
      object: "skill:skill-1",
    });

    expect(allowed).toBeTrue();
    expect(requestUrl).toBe("http://openfga.test/stores/store%2Fone/check");
    expect(requestBody).toEqual({
      authorization_model_id: "model-one",
      tuple_key: {
        user: "user:alice",
        relation: "can_edit",
        object: "skill:skill-1",
      },
    });
  });

  // Enterprise Policy 的单资源判断只能由 OpenFGA 决定，并输出统一 selector。
  test("单资源 Check 允许后输出 ids 与 scopeTags", async () => {
    const policy = new EnterpriseOpenFgaAuthorizationPolicy(
      {
        check: async () => true,
        listObjects: async () => [],
      },
      { "skill:edit": "can_edit" },
    );

    const decision = await policy.authorize(
      { id: "alice" },
      {
        resourceType: "skill",
        action: "skill:edit",
        resourceId: "skill-1",
        scopeTags: { "enterprise.tenant": "tenant-a" },
      },
    );

    expect(decision).toEqual({
      result: "allow-filtered",
      selector: {
        ids: ["skill-1"],
        scopeTags: { "enterprise.tenant": "tenant-a" },
      },
    });
  });

  // ListObjects 结果必须与调用方请求 IDs 求交集后再交给 Core。
  test("列表授权输出 OpenFGA IDs 与请求 IDs 的交集", async () => {
    const policy = new EnterpriseOpenFgaAuthorizationPolicy(
      {
        check: async () => false,
        listObjects: async () => ["skill:skill-1", "skill:skill-2", "agent:agent-1"],
      },
      { "skill:list": "can_read" },
    );

    const decision = await policy.authorize(
      { id: "alice" },
      {
        resourceType: "skill",
        action: "skill:list",
        requestedIds: ["skill-2", "skill-3"],
        scopeTags: { "enterprise.tenant": "tenant-a" },
      },
    );

    expect(decision).toEqual({
      result: "allow-filtered",
      selector: {
        ids: ["skill-2"],
        scopeTags: { "enterprise.tenant": "tenant-a" },
      },
    });
  });

  // 未配置的业务动作必须失败关闭，不得隐式映射为 OpenFGA 关系。
  test("未映射动作默认拒绝", async () => {
    const policy = new EnterpriseOpenFgaAuthorizationPolicy(
      { check: async () => true, listObjects: async () => ["skill:skill-1"] },
      {},
    );

    await expect(
      policy.authorize(
        { id: "alice" },
        { resourceType: "skill", action: "skill:unknown", resourceId: "skill-1" },
      ),
    ).resolves.toEqual({ result: "deny", reason: "unmapped_action:skill:unknown" });
  });
});
