import { describe, expect, test } from "bun:test";
import { OpenFgaAuthorizationPlugin } from "../index";

const request = {
  subject: {
    kind: "user" as const,
    id: "alice",
    organizationId: "org_1",
    organizationRole: "member" as const,
  },
  action: "skill:share",
  resource: { kind: "skill", id: "document-search", organizationId: "org_1" },
};

describe("OpenFGA authorization plugin", () => {
  // 插件应将领域请求转换为指定 Store、模型和关系的 Check 调用。
  test("将 Skill 共享动作映射为 OpenFGA 的 can_share", async () => {
    let received: RequestInit | undefined;
    let endpoint = "";
    const plugin = new OpenFgaAuthorizationPlugin(
      { apiUrl: "http://openfga.test/", storeId: "store_1", authorizationModelId: "model_1" },
      {
        fetchFn: async (input, init) => {
          endpoint = String(input);
          received = init;
          return new Response(JSON.stringify({ allowed: true }), { status: 200 });
        },
      },
    );

    await expect(plugin.check(request)).resolves.toBe(true);
    expect(endpoint).toBe("http://openfga.test/stores/store_1/check");
    expect(JSON.parse(String(received?.body))).toEqual({
      authorization_model_id: "model_1",
      tuple_key: { user: "user:alice", relation: "can_share", object: "skill:document-search" },
    });
  });

  // 组织 owner/admin 的可信认证事实必须作为上下文关系交给 OpenFGA 推导，而不是由 Core 直接放行。
  test("组织管理员修改 Skill 公开权限时提供 OpenFGA 上下文关系", async () => {
    let body = "";
    const plugin = new OpenFgaAuthorizationPlugin(
      { apiUrl: "http://openfga.test", storeId: "store_1", authorizationModelId: "model_1" },
      {
        fetchFn: async (_input, init) => {
          body = String(init.body);
          return new Response(JSON.stringify({ allowed: true }), { status: 200 });
        },
      },
    );

    await expect(plugin.check({ ...request, subject: { ...request.subject, organizationRole: "admin" } })).resolves.toBe(
      true,
    );
    expect(JSON.parse(body).contextual_tuples).toEqual({
      tuple_keys: [
        { user: "organization:org_1", relation: "organization", object: "skill:document-search" },
        { user: "user:alice", relation: "org_admin", object: "organization:org_1" },
      ],
    });
  });

  // 组织 owner 与组织 admin 同属组织治理事实，但必须映射为模型中各自独立的关系。
  test("组织 owner 修改 Skill 公开权限时提供 org_owner 上下文关系", async () => {
    let body = "";
    const plugin = new OpenFgaAuthorizationPlugin(
      { apiUrl: "http://openfga.test", storeId: "store_1", authorizationModelId: "model_1" },
      {
        fetchFn: async (_input, init) => {
          body = String(init.body);
          return new Response(JSON.stringify({ allowed: true }), { status: 200 });
        },
      },
    );

    await expect(plugin.check({ ...request, subject: { ...request.subject, organizationRole: "owner" } })).resolves.toBe(
      true,
    );
    expect(JSON.parse(body).contextual_tuples.tuple_keys[1]).toEqual({
      user: "user:alice",
      relation: "org_owner",
      object: "organization:org_1",
    });
  });

  // Skill 编辑与使用必须映射到命名基线中的独立能力，不能通过 can_write 或共享权限相互替代。
  test("分别映射 Skill 编辑与使用能力", async () => {
    const tupleKeys: unknown[] = [];
    const plugin = new OpenFgaAuthorizationPlugin(
      { apiUrl: "http://openfga.test", storeId: "store_1", authorizationModelId: "model_1" },
      {
        fetchFn: async (_input, init) => {
          tupleKeys.push(JSON.parse(String(init.body)).tuple_key);
          return new Response(JSON.stringify({ allowed: true }), { status: 200 });
        },
      },
    );

    await plugin.check({ ...request, action: "skill:edit" });
    await plugin.check({ ...request, action: "skill:use" });

    expect(tupleKeys).toEqual([
      { user: "user:alice", relation: "can_edit", object: "skill:document-search" },
      { user: "user:alice", relation: "can_use", object: "skill:document-search" },
    ]);
  });

  // skill:create 必须检查 Skill Space；错误资源边界应在调用 OpenFGA 前保守拒绝。
  test("拒绝动作与资源类型不匹配的请求", async () => {
    let requestCount = 0;
    const plugin = new OpenFgaAuthorizationPlugin(
      { apiUrl: "http://openfga.test", storeId: "store_1", authorizationModelId: "model_1" },
      {
        fetchFn: async () => {
          requestCount += 1;
          return new Response(JSON.stringify({ allowed: true }), { status: 200 });
        },
      },
    );

    await expect(plugin.check({ ...request, action: "skill:create" })).resolves.toBe(false);
    expect(requestCount).toBe(0);
  });

  // OpenFGA 不可用时必须拒绝，避免高风险操作在故障期间被放行。
  test("OpenFGA 不可用时默认拒绝", async () => {
    const plugin = new OpenFgaAuthorizationPlugin(
      { apiUrl: "http://openfga.test", storeId: "store_1", authorizationModelId: "model_1" },
      {
        fetchFn: async () => {
          throw new Error("connection refused");
        },
      },
    );

    await expect(plugin.check(request)).resolves.toBe(false);
  });

  // 企业已有 OpenFGA 模型时只替换映射，不需改动 FenixAgent 的领域调用。
  test("可替换为客户自有 OpenFGA 模型映射", async () => {
    let body = "";
    const plugin = new OpenFgaAuthorizationPlugin(
      { apiUrl: "http://openfga.test", storeId: "customer_store", authorizationModelId: "customer_model" },
      {
        mapper: {
          toCheckTuple: () => ({ user: "employee:alice", relation: "run_skill", object: "capability:document-search" }),
        },
        fetchFn: async (_input, init) => {
          body = String(init.body);
          return new Response(JSON.stringify({ allowed: true }), { status: 200 });
        },
      },
    );

    await expect(plugin.check(request)).resolves.toBe(true);
    expect(JSON.parse(body).tuple_key).toEqual({
      user: "employee:alice",
      relation: "run_skill",
      object: "capability:document-search",
    });
  });

  // 默认模型不允许跨组织关系判断，防止模型或 tuple 配置错误时越过租户边界。
  test("默认映射拒绝跨组织请求且不发起 OpenFGA 调用", async () => {
    let requestCount = 0;
    const plugin = new OpenFgaAuthorizationPlugin(
      { apiUrl: "http://openfga.test", storeId: "store_1", authorizationModelId: "model_1" },
      {
        fetchFn: async () => {
          requestCount += 1;
          return new Response(JSON.stringify({ allowed: true }), { status: 200 });
        },
      },
    );

    await expect(
      plugin.check({ ...request, resource: { ...request.resource, organizationId: "other_org" } }),
    ).resolves.toBe(false);
    expect(requestCount).toBe(0);
  });
});
