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
      if (url.pathname === "/api/skills" && request.method === "GET") {
        return json({ skills: runtime.skills.list() });
      }
      if (url.pathname === "/api/skills" && request.method === "POST") {
        const body = await readBody(request);
        const skill = runtime.skills.create({
          name: requiredString(body, "name"),
          description: requiredString(body, "description"),
          prompt: requiredString(body, "prompt"),
        });
        return json({ skill }, 201);
      }

      const skillId = decodeSkillPath(url.pathname);
      if (skillId && request.method === "GET") {
        return json({ skill: runtime.skills.get(skillId) });
      }
      if (skillId && request.method === "PUT") {
        const body = await readBody(request);
        const skill = runtime.skills.update(skillId, {
          name: optionalString(body, "name"),
          description: optionalString(body, "description"),
          prompt: optionalString(body, "prompt"),
        });
        return json({ skill });
      }
      if (skillId && request.method === "DELETE") {
        runtime.skills.delete(skillId);
        return new Response(null, { status: 204 });
      }
      if (skillId && url.pathname.endsWith("/run") && request.method === "POST") {
        const body = await readBody(request);
        const source = optionalString(body, "source");
        return json({ result: runtime.skills.run(skillId, source) });
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

function decodeSkillPath(pathname: string): string | undefined {
  const match = /^\/api\/skills\/([^/]+)(?:\/run)?$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function errorStatus(error: unknown): number {
  if (error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  return 400;
}
