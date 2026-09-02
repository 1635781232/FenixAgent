import { createCommunitySkillApplication } from "./index";

const runtime = createCommunitySkillApplication();
await runtime.start();

const port = resolvePort(process.env.PORT);

const assets: Record<string, { readonly file: string; readonly contentType: string }> = {
  "/": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", contentType: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", contentType: "text/css; charset=utf-8" },
};

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/organization" && request.method === "GET") {
        return json({ organization: runtime.organization.snapshot() });
      }
      if (url.pathname === "/api/skills" && request.method === "GET") {
        const principal = currentPrincipal(request);
        const query = {
          keyword: url.searchParams.get("keyword") ?? undefined,
          status: optionalSkillStatus(url.searchParams.get("status") ?? undefined),
        };
        const candidates = runtime.skills.list(query);
        return runtime.authorization.run(
          principal,
          {
            resourceType: "skill",
            action: "skill:use",
            requestedIds: candidates.map((skill) => skill.id),
          },
          async ({ selector }) => {
            const skills = runtime.skills.list(query, selector);
            return json({
              skills,
              authorization: authorizationTrace(principal.id, "skill:use", candidates.length, skills.length),
            });
          },
        );
      }
      if (url.pathname === "/api/skills" && request.method === "POST") {
        const principal = currentPrincipal(request);
        const body = await readBody(request);
        return runtime.authorization.run(
          principal,
          { resourceType: "skill", action: "skill:create" },
          async () => {
            const skill = runtime.skills.create({
              name: requiredString(body, "name"),
              description: requiredString(body, "description"),
              prompt: requiredString(body, "prompt"),
              status: optionalSkillStatus(optionalString(body, "status")),
            });
            return json({ skill }, 201);
          },
        );
      }

      const accessSkillId = decodeSkillAccessPath(url.pathname);
      if (accessSkillId && request.method === "GET") {
        const principal = currentPrincipal(request);
        runtime.skills.get(accessSkillId);
        const [canEdit, canDelete] = await Promise.all([
          runtime.authorization.check(principal, {
            resourceType: "skill",
            action: "skill:edit",
            resourceId: accessSkillId,
          }),
          runtime.authorization.check(principal, {
            resourceType: "skill",
            action: "skill:delete",
            resourceId: accessSkillId,
          }),
        ]);
        return json({
          permissions: { canEdit, canDelete },
          authorization: {
            provider: runtime.authorizationProvider,
            principalId: principal.id,
            checks: ["skill:edit", "skill:delete"],
          },
        });
      }

      const skillId = decodeSkillPath(url.pathname);
      if (skillId && request.method === "GET") {
        const principal = currentPrincipal(request);
        return runtime.authorization.run(
          principal,
          { resourceType: "skill", action: "skill:use", resourceId: skillId },
          async () => json({ skill: runtime.skills.get(skillId) }),
        );
      }
      if (skillId && request.method === "PUT") {
        const principal = currentPrincipal(request);
        const body = await readBody(request);
        return runtime.authorization.run(
          principal,
          { resourceType: "skill", action: "skill:edit", resourceId: skillId },
          async () => {
            const skill = runtime.skills.update(skillId, {
              name: optionalString(body, "name"),
              description: optionalString(body, "description"),
              prompt: optionalString(body, "prompt"),
              status: optionalSkillStatus(optionalString(body, "status")),
            });
            return json({ skill });
          },
        );
      }
      if (skillId && request.method === "DELETE") {
        const principal = currentPrincipal(request);
        return runtime.authorization.run(
          principal,
          { resourceType: "skill", action: "skill:delete", resourceId: skillId },
          async () => {
            runtime.skills.delete(skillId);
            return new Response(null, { status: 204 });
          },
        );
      }
      if (skillId && url.pathname.endsWith("/run") && request.method === "POST") {
        const principal = currentPrincipal(request);
        const body = await readBody(request);
        const source = optionalString(body, "source");
        return runtime.authorization.run(
          principal,
          { resourceType: "skill", action: "skill:use", resourceId: skillId },
          async () => json({ result: runtime.skills.run(skillId, source) }),
        );
      }

      const asset = assets[url.pathname];
      if (asset) {
        return new Response(Bun.file(new URL(`../public/${asset.file}`, import.meta.url)), {
          headers: { "content-type": asset.contentType, "cache-control": "no-store" },
        });
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "Unexpected error" },
        errorStatus(error),
      );
    }
  },
});

console.log(`Community Skill demo: http://localhost:${server.port}`);

function resolvePort(value: string | undefined): number {
  if (value === undefined) return 3400;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT 必须是 1 至 65535 的整数");
  return port;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("请求体必须是 JSON 对象");
  return body as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = optionalString(body, key);
  if (value === undefined) throw new Error(`${key} 为必填字段`);
  return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${key} 必须是字符串`);
  return value;
}

function optionalSkillStatus(value: string | undefined): "draft" | "published" | undefined {
  if (value === undefined || value === "") return undefined;
  if (value === "draft" || value === "published") return value;
  throw new Error("status 必须是 draft 或 published");
}

function decodeSkillPath(pathname: string): string | undefined {
  const match = /^\/api\/skills\/([^/]+)(?:\/run)?$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function decodeSkillAccessPath(pathname: string): string | undefined {
  const match = /^\/api\/skills\/([^/]+)\/access$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function currentPrincipal(request: Request) {
  const principalId = request.headers.get("x-demo-user-id")?.trim() || "alice";
  const member = runtime.organization.snapshot().members.find((candidate) => candidate.id === principalId);
  if (!member) throw new Error(`未知演示用户：${principalId}`);
  return {
    id: member.id,
    type: "user",
    attributes: { departmentId: member.departmentId, role: member.role },
  };
}

function authorizationTrace(principalId: string, action: string, candidates: number, returned: number) {
  return {
    provider: runtime.authorizationProvider,
    principalId,
    action,
    result: "allow-filtered",
    candidates,
    returned,
  } as const;
}

function errorStatus(error: unknown): number {
  if (error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  return 400;
}
