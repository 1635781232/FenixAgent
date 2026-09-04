import type { OpenFgaConfig, OpenFgaFetch } from "@fenix/app-platform-openfga";

/** OpenFGA 演示初始化所需的最小模型结构。 */
export interface OpenFgaAuthorizationModelDocument {
  readonly schema_version: string;
  readonly type_definitions: readonly unknown[];
  readonly conditions?: Readonly<Record<string, unknown>>;
}

interface OpenFgaStore {
  readonly id: string;
  readonly name: string;
}

interface TupleKey {
  readonly user: string;
  readonly relation: string;
  readonly object: string;
}

interface OpenFgaReadTuple {
  readonly key: TupleKey;
}

const DEMO_STORE_NAME = "fenixagent-v4-skill-demo";

/** Enterprise 演示使用的业务动作到 OpenFGA 权限关系映射。 */
export const SKILL_DEMO_ACTION_RELATIONS = Object.freeze({
  "skill:create": "can_create_skill",
  "skill:use": "can_use",
  "skill:edit": "can_edit",
  "skill:delete": "can_delete",
});

const DEMO_TUPLES: readonly TupleKey[] = [
  tuple("user:alice", "org_owner", "organization:fenixagent"),
  tuple("user:alice", "member", "organization:fenixagent"),
  tuple("user:bob", "member", "organization:fenixagent"),
  tuple("user:carol", "member", "organization:fenixagent"),

  tuple("organization:fenixagent", "organization", "department:headquarters"),
  tuple("user:alice", "member", "department:headquarters"),
  tuple("organization:fenixagent", "organization", "department:product"),
  tuple("department:headquarters", "parent", "department:product"),
  tuple("user:bob", "member", "department:product"),
  tuple("organization:fenixagent", "organization", "department:development"),
  tuple("department:headquarters", "parent", "department:development"),
  tuple("user:carol", "member", "department:development"),

  tuple("organization:fenixagent", "organization", "skill_space:shared-space"),
  tuple("user:alice", "resource_admin", "skill_space:shared-space"),
  tuple("user:alice", "member", "skill_space:shared-space"),
  tuple("user:bob", "member", "skill_space:shared-space"),
  tuple("user:carol", "member", "skill_space:shared-space"),
  tuple("organization:fenixagent", "organization", "skill_space:product-space"),
  tuple("user:alice", "resource_admin", "skill_space:product-space"),
  tuple("user:bob", "resource_admin", "skill_space:product-space"),
  tuple("organization:fenixagent", "organization", "skill_space:dev-space"),
  tuple("user:alice", "resource_admin", "skill_space:dev-space"),
  tuple("user:carol", "resource_admin", "skill_space:dev-space"),

  ...skillBase("skill-1", "shared-space", "alice"),
  tuple("department:product#member", "shared_with", "skill:skill-1"),
  ...skillBase("skill-2", "product-space", "alice"),
  ...skillBase("skill-3", "shared-space", "alice"),
  tuple("department:product#member", "editor", "skill:skill-3"),
  ...skillBase("skill-4", "product-space", "alice"),
  ...skillBase("skill-5", "product-space", "alice"),
  ...skillBase("skill-6", "dev-space", "carol"),
  ...skillBase("skill-7", "dev-space", "carol"),
  ...skillBase("skill-8", "shared-space", "alice"),
  tuple("department:product#member", "shared_with", "skill:skill-8"),
  tuple("department:development#member", "shared_with", "skill:skill-8"),
  ...skillBase("skill-9", "dev-space", "carol"),
  ...skillBase("skill-10", "dev-space", "carol"),
  ...skillBase("skill-11", "shared-space", "alice"),
  tuple("department:product#member", "shared_with", "skill:skill-11"),
  tuple("department:product#member", "editor", "skill:skill-11"),
  ...skillBase("skill-12", "dev-space", "carol"),
];

/** OpenFGA 演示启动结果；Store 和模型均由启动脚本显式传给 Enterprise App。 */
export interface OpenFgaDemoBootstrapResult {
  readonly config: OpenFgaConfig;
  readonly storeName: string;
  readonly tupleCount: number;
}

/**
 * 创建或复用隔离的演示 Store，发布模型并校准确定性的组织、部门和 Skill 关系。
 *
 * 固定名称只属于本地架构验证，关系同步仅作用于这个专用 Store，不修改用户已有 Store。
 */
export async function bootstrapOpenFgaSkillDemo(
  apiUrl: string,
  model: OpenFgaAuthorizationModelDocument,
  fetcher: OpenFgaFetch = fetch,
): Promise<OpenFgaDemoBootstrapResult> {
  const normalizedApiUrl = apiUrl.trim().replace(/\/+$/, "");
  if (!normalizedApiUrl) throw new Error("OpenFGA apiUrl 不能为空");

  const storesResponse = await get<{ stores?: readonly OpenFgaStore[] }>(
    fetcher,
    `${normalizedApiUrl}/stores?page_size=100`,
  );
  const existingStore = storesResponse.stores?.find((store) => store.name === DEMO_STORE_NAME);
  const store = existingStore ?? await post<OpenFgaStore>(fetcher, `${normalizedApiUrl}/stores`, {
    name: DEMO_STORE_NAME,
  });
  const modelResponse = await post<{ authorization_model_id: string }>(
    fetcher,
    `${normalizedApiUrl}/stores/${encodeURIComponent(store.id)}/authorization-models`,
    model,
  );
  if (!modelResponse.authorization_model_id?.trim()) {
    throw new Error("OpenFGA 创建模型后未返回 authorization_model_id");
  }

  const readResponse = await post<{ tuples?: readonly OpenFgaReadTuple[] }>(
    fetcher,
    `${normalizedApiUrl}/stores/${encodeURIComponent(store.id)}/read`,
    { page_size: 100 },
  );
  const existingTuples = (readResponse.tuples ?? []).map((item) => item.key);
  const desiredKeys = new Set(DEMO_TUPLES.map(tupleIdentity));
  const existingKeys = new Set(existingTuples.map(tupleIdentity));
  const writes = DEMO_TUPLES.filter((item) => !existingKeys.has(tupleIdentity(item)));
  const deletes = existingTuples.filter((item) => !desiredKeys.has(tupleIdentity(item)));

  if (writes.length || deletes.length) {
    await post(
      fetcher,
      `${normalizedApiUrl}/stores/${encodeURIComponent(store.id)}/write`,
      {
        authorization_model_id: modelResponse.authorization_model_id,
        ...(writes.length ? { writes: { tuple_keys: writes } } : {}),
        ...(deletes.length ? { deletes: { tuple_keys: deletes } } : {}),
      },
    );
  }

  return {
    config: {
      apiUrl: normalizedApiUrl,
      storeId: store.id,
      authorizationModelId: modelResponse.authorization_model_id,
    },
    storeName: store.name,
    tupleCount: DEMO_TUPLES.length,
  };
}

/** 从 Enterprise 插件随附模型启动本地演示，App 无需知道模型文件位置或 OpenFGA 结构。 */
export async function bootstrapBundledOpenFgaSkillDemo(
  apiUrl: string,
  fetcher: OpenFgaFetch = fetch,
): Promise<OpenFgaDemoBootstrapResult> {
  const document: unknown = await Bun.file(
    new URL("../model/authorization-model.json", import.meta.url),
  ).json();
  if (!isAuthorizationModelDocument(document)) {
    throw new Error("Enterprise 插件随附的 OpenFGA 模型结构不合法");
  }
  return bootstrapOpenFgaSkillDemo(apiUrl, document, fetcher);
}

function skillBase(skillId: string, spaceId: string, ownerId: string): readonly TupleKey[] {
  return [
    tuple("organization:fenixagent", "organization", `skill:${skillId}`),
    tuple(`skill_space:${spaceId}`, "space", `skill:${skillId}`),
    tuple(`user:${ownerId}`, "owner", `skill:${skillId}`),
    tuple(`user:${ownerId}`, "creator", `skill:${skillId}`),
  ];
}

function tuple(user: string, relation: string, object: string): TupleKey {
  return { user, relation, object };
}

function tupleIdentity(value: TupleKey): string {
  return `${value.user}\u0000${value.relation}\u0000${value.object}`;
}

function isAuthorizationModelDocument(value: unknown): value is OpenFgaAuthorizationModelDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<OpenFgaAuthorizationModelDocument>;
  return typeof candidate.schema_version === "string" && Array.isArray(candidate.type_definitions);
}

async function post<T = Record<string, unknown>>(
  fetcher: OpenFgaFetch,
  url: string,
  body: unknown,
): Promise<T> {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const details = (await response.text()).trim();
    throw new Error(`OpenFGA demo bootstrap failed: HTTP ${response.status}${details ? ` ${details}` : ""}`);
  }
  const text = await response.text();
  if (!text) return {} as T;
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OpenFGA demo bootstrap response must be a JSON object");
  }
  return parsed as T;
}

async function get<T>(fetcher: OpenFgaFetch, url: string): Promise<T> {
  const response = await fetcher(url);
  if (!response.ok) {
    const details = (await response.text()).trim();
    throw new Error(`OpenFGA demo bootstrap failed: HTTP ${response.status}${details ? ` ${details}` : ""}`);
  }
  const parsed: unknown = await response.json();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OpenFGA demo bootstrap response must be a JSON object");
  }
  return parsed as T;
}
