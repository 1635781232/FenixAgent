import { authorizationModel, OpenFgaAuthorizationPlugin } from "@fenix/openfga-authorization-plugin";

const apiUrl = process.env.RCS_OPENFGA_API_URL?.trim() ?? "http://127.0.0.1:8080";

type ApiOptions = { method?: "GET" | "POST" | "DELETE"; body?: unknown };
type TupleKey = { user: string; relation: string; object: string };

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: options.body === undefined ? undefined : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) throw new Error(`${path} failed: HTTP ${response.status} ${await response.text()}`);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function assertEqual<T>(label: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  console.log(`PASS  ${label}: ${JSON.stringify(actual)}`);
}

async function waitForOpenFga(): Promise<void> {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      if ((await fetch(`${apiUrl.replace(/\/$/, "")}/healthz`)).ok) return;
    } catch (error) {
      if (attempt === 20) throw new Error("OpenFGA health check failed", { cause: error });
    }
    await Bun.sleep(500);
  }
  throw new Error(`OpenFGA did not become healthy at ${apiUrl}`);
}

await waitForOpenFga();
const store = await request<{ id: string }>("/stores", {
  body: { name: `fenix-skill-permission-demo-${Date.now()}` },
});

try {
  const published = await request<{ authorization_model_id: string }>(`/stores/${store.id}/authorization-models`, {
    body: authorizationModel,
  });
  const authorizationModelId = published.authorization_model_id;
  const tuples: TupleKey[] = [
    { user: "organization:acme", relation: "organization", object: "skill_space:acme" },
    { user: "user:admin", relation: "resource_admin", object: "skill_space:acme" },
    { user: "organization:acme", relation: "organization", object: "department:product" },
    { user: "organization:acme", relation: "organization", object: "department:development" },
    { user: "user:alice", relation: "member", object: "department:product" },
    { user: "user:bob", relation: "member", object: "department:development" },
    { user: "organization:acme", relation: "organization", object: "skill:smart-report" },
    { user: "user:admin", relation: "owner", object: "skill:smart-report" },
    { user: "user:admin", relation: "creator", object: "skill:smart-report" },
    { user: "skill_space:acme", relation: "space", object: "skill:smart-report" },
    { user: "department:product#member", relation: "editor", object: "skill:smart-report" },
    { user: "department:product#member", relation: "sharer", object: "skill:smart-report" },
    { user: "department:product#member", relation: "shared_with", object: "skill:smart-report" },
    { user: "department:development#member", relation: "editor", object: "skill:smart-report" },
  ];
  await request(`/stores/${store.id}/write`, {
    body: { authorization_model_id: authorizationModelId, writes: { tuple_keys: tuples } },
  });

  const plugin = new OpenFgaAuthorizationPlugin({ apiUrl, storeId: store.id, authorizationModelId });
  const resource = { kind: "skill", id: "smart-report", organizationId: "acme" };
  const subject = (id: string) => ({ kind: "user" as const, id, organizationId: "acme" });
  const check = (userId: string, action: string) => plugin.check({ subject: subject(userId), action, resource });

  assertEqual("admin can edit", await check("admin", "skill:edit"), true);
  assertEqual("admin can share", await check("admin", "skill:share"), true);
  assertEqual("admin can use", await check("admin", "skill:use"), true);
  assertEqual("alice can edit", await check("alice", "skill:edit"), true);
  assertEqual("alice can share", await check("alice", "skill:share"), true);
  assertEqual("alice can use", await check("alice", "skill:use"), true);
  assertEqual("bob can edit", await check("bob", "skill:edit"), true);
  assertEqual("bob cannot share", await check("bob", "skill:share"), false);
  assertEqual("bob cannot use", await check("bob", "skill:use"), false);
  assertEqual(
    "cross-organization request is denied before OpenFGA",
    await plugin.check({
      subject: { kind: "user", id: "alice", organizationId: "other-org" },
      action: "skill:use",
      resource,
    }),
    false,
  );

  const listResult = await request<{ objects?: string[] }>(`/stores/${store.id}/list-objects`, {
    body: {
      authorization_model_id: authorizationModelId,
      type: "skill",
      relation: "can_use",
      user: "user:alice",
    },
  });
  assertEqual("ListObjects returns Alice authorized Skill", listResult.objects ?? [], ["skill:smart-report"]);

  const aliceUseTuple = {
    user: "department:product#member",
    relation: "shared_with",
    object: "skill:smart-report",
  };
  await request(`/stores/${store.id}/write`, {
    body: { authorization_model_id: authorizationModelId, deletes: { tuple_keys: [aliceUseTuple] } },
  });
  assertEqual("Alice loses use after relationship revocation", await check("alice", "skill:use"), false);
  assertEqual("Alice edit remains independent after use revocation", await check("alice", "skill:edit"), true);

  console.log(`Store: ${store.id}`);
  console.log(`Authorization model: ${authorizationModelId}`);
  console.log("FenixAgent OpenFGA Skill permission demo completed successfully.");
} finally {
  if (process.env.KEEP_DEMO_STORE !== "1") {
    await request(`/stores/${store.id}`, { method: "DELETE" });
  }
}
