import { describe, expect, test } from "bun:test";
import {
  AuthorizationDeniedError,
  AuthorizedOperationExecutor,
} from "@fenix/app-platform";
import { OpenFgaClient, type OpenFgaFetch } from "@fenix/app-platform-openfga";
import {
  EnterpriseOpenFgaAuthorizationPolicy,
  bootstrapOpenFgaSkillDemo,
} from "@fenix-enterprise/openfga-authorization-plugin";
import {
  ENTERPRISE_SKILL_PERMISSIONS,
  EnterpriseSkillApplication,
} from "@fenix-enterprise/skill-plugin";
import { CommunityAllowAllAuthorizationPolicy } from "@fenix/community-app-kit";
import { SkillService } from "@fenix/core";
import type { AuthorizationPolicy, ResourceOperation } from "@fenix/plugin-sdk";

const OPENFGA_CONFIG = {
  apiUrl: "http://openfga.test/",
  storeId: "store/one",
  authorizationModelId: "model-one",
} as const;

interface DemoWritePayload {
  readonly authorization_model_id: string;
  readonly writes: {
    readonly tuple_keys: readonly {
      readonly user: string;
      readonly relation: string;
      readonly object: string;
    }[];
  };
}

describe("统一授权拦截器", () => {
  // Community 版不能绕过统一接口，而应把业务候选 IDs 原样作为允许范围返回。
  test("Community Provider 通过统一接口返回全部候选资源", async () => {
    const policy = new CommunityAllowAllAuthorizationPolicy();

    await expect(
      policy.authorize(
        { id: "alice", type: "user" },
        {
          resourceType: "skill",
          action: "skill:use",
          requestedIds: ["skill-1", "skill-2"],
        },
      ),
    ).resolves.toEqual({
      result: "allow-filtered",
      selector: { ids: ["skill-1", "skill-2"], scopeTags: undefined },
    });
  });

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

  // 前端能力检查必须把拒绝决策转换为 false，页面据此隐藏编辑按钮。
  test("单资源能力检查返回拒绝结果", async () => {
    const executor = new AuthorizedOperationExecutor({
      authorize: async () => ({ result: "deny", reason: "no_edit_permission" }),
    });

    await expect(
      executor.check(
        { id: "alice" },
        { resourceType: "skill", action: "skill:edit", resourceId: "skill-1" },
      ),
    ).resolves.toBeFalse();
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
  // Demo 初始化必须发布模型并投影组织、部门、空间和 Skill 关系，不能只创建空 Store。
  test("OpenFGA Demo 写入完整关系数据", async () => {
    let writePayload: DemoWritePayload | undefined;
    const fetcher: OpenFgaFetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/stores?page_size=")) return Response.json({ stores: [] });
      if (url.endsWith("/stores")) return Response.json({ id: "store-demo", name: "demo" });
      if (url.endsWith("/authorization-models")) {
        return Response.json({ authorization_model_id: "model-demo" });
      }
      if (url.endsWith("/write")) {
        writePayload = JSON.parse(String(init?.body)) as DemoWritePayload;
        return Response.json({});
      }
      if (url.endsWith("/read")) return Response.json({ tuples: [] });
      throw new Error(`Unexpected OpenFGA request: ${url}`);
    };

    const result = await bootstrapOpenFgaSkillDemo(
      "http://openfga.test/",
      { schema_version: "1.1", type_definitions: [] },
      fetcher,
    );

    expect(result.config).toEqual({
      apiUrl: "http://openfga.test",
      storeId: "store-demo",
      authorizationModelId: "model-demo",
    });
    expect(result.tupleCount).toBe(77);
    expect(writePayload?.writes.tuple_keys).toContainEqual({
      user: "department:product#member",
      relation: "shared_with",
      object: "skill:skill-1",
    });
    expect(writePayload?.writes.tuple_keys).toContainEqual({
      user: "user:bob",
      relation: "resource_admin",
      object: "skill_space:product-space",
    });
  });

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

describe("Enterprise Skill 插件", () => {
  // Enterprise Skill 必须通过统一业务权限调用授权端口，并把返回 selector 交给 Core。
  test("编辑 Skill 经授权端口后调用 Core", async () => {
    const operations: ResourceOperation[] = [];
    const policy: AuthorizationPolicy = {
      authorize: async (_principal, operation) => {
        operations.push(operation);
        return {
          result: "allow-filtered",
          selector: { ids: operation.resourceId ? [operation.resourceId] : [] },
        };
      },
    };
    const application = new EnterpriseSkillApplication(
      new SkillService(),
      new AuthorizedOperationExecutor(policy),
    );

    const updated = await application.update(
      { id: "alice", type: "user" },
      "skill-1",
      { name: "企业会议纪要助手" },
    );

    expect(updated.name).toBe("企业会议纪要助手");
    expect(operations).toEqual([
      {
        resourceType: "skill",
        resourceId: "skill-1",
        action: ENTERPRISE_SKILL_PERMISSIONS.EDIT,
      },
    ]);
  });
});
