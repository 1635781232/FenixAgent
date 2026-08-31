import { OpenFgaAuthorizationPlugin } from "@fenix/openfga-authorization-plugin";

const apiUrl = process.env.RCS_OPENFGA_API_URL ?? "http://127.0.0.1:8080";

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

const model = {
  schema_version: "1.1",
  type_definitions: [
    { type: "user", relations: {} },
    {
      type: "skill",
      relations: {
        owner: { this: {} },
        reader: { this: {} },
        can_read: {
          union: { child: [{ computedUserset: { relation: "owner" } }, { computedUserset: { relation: "reader" } }] },
        },
        can_write: { computedUserset: { relation: "owner" } },
        can_delete: { computedUserset: { relation: "owner" } },
        can_share: { computedUserset: { relation: "owner" } },
      },
      metadata: {
        relations: {
          owner: { directly_related_user_types: [{ type: "user" }] },
          reader: { directly_related_user_types: [{ type: "user" }] },
        },
      },
    },
  ],
};

const demoResource = { kind: "skill", id: "demo-skill", organizationId: "org_demo" };
const alice = {
  kind: "user" as const,
  id: "alice",
  organizationId: "org_demo",
};
const bob = {
  kind: "user" as const,
  id: "bob",
  organizationId: "org_demo",
};

const store = await request<{ id: string }>("/stores", { name: `fenix-openfga-plugin-${Date.now()}` });
const published = await request<{ authorization_model_id: string }>(`/stores/${store.id}/authorization-models`, model);
await request(`/stores/${store.id}/write`, {
  authorization_model_id: published.authorization_model_id,
  writes: { tuple_keys: [{ user: "user:alice", relation: "owner", object: "skill:demo-skill" }] },
});

const plugin = new OpenFgaAuthorizationPlugin({
  apiUrl,
  storeId: store.id,
  authorizationModelId: published.authorization_model_id,
});
// Demo 只通过领域主体、动作和资源调用插件，不在脚本侧构造 OpenFGA Check tuple。
const canShare = (subject: typeof alice) => plugin.check({ subject, action: "skill:share", resource: demoResource });

console.log(`Store: ${store.id}`);
console.log(`Model: ${published.authorization_model_id}`);
console.log(`Alice can share: ${await canShare(alice)}`);
console.log(`Bob can share: ${await canShare(bob)}`);

await request(`/stores/${store.id}/write`, {
  authorization_model_id: published.authorization_model_id,
  deletes: { tuple_keys: [{ user: "user:alice", relation: "owner", object: "skill:demo-skill" }] },
});
console.log(`Alice can share after revocation: ${await canShare(alice)}`);
