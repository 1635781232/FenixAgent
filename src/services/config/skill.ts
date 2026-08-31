import { createLogger } from "@fenix/logger";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { skill } from "../../db/schema";
import type { AuthContext } from "../../plugins/auth";
import {
  assertInternalWritable,
  canReadResource,
  decorateResourceAccess,
  listReadableResourceRefs,
  setPublicRead,
} from "../resource-permission";
import type { SkillConfigRowWithAccess, SkillSetOptions, SkillUpsertData } from "./types";

const logger = createLogger("config-skill");

// ────────────────────────────────────────────
// Skill 操作（全局技能库）
// ────────────────────────────────────────────

type SkillConfigRow = Omit<SkillConfigRowWithAccess, "resourceAccess">;

function parseResourceKey(resourceKey: string) {
  const slashIndex = resourceKey.indexOf("/");
  if (slashIndex <= 0 || slashIndex === resourceKey.length - 1) return null;
  return {
    sourceOrganizationId: resourceKey.slice(0, slashIndex),
    resourceUid: resourceKey.slice(slashIndex + 1),
  };
}

async function listExternalSkills(ctx: AuthContext): Promise<SkillConfigRow[]> {
  const refs = await listReadableResourceRefs(ctx, "skill");
  const ids = refs.map((ref) => ref.resourceId);
  if (ids.length === 0) return [];

  const rows = (await db.select().from(skill).where(inArray(skill.id, ids))) as SkillConfigRow[];
  const refKeys = new Set(refs.map((ref) => `${ref.organizationId}/${ref.resourceId}`));
  return rows.filter((row) => refKeys.has(`${row.organizationId}/${row.id}`));
}

export async function listSkills(ctx: AuthContext): Promise<SkillConfigRowWithAccess[]> {
  const internal = (await db
    .select()
    .from(skill)
    .where(eq(skill.organizationId, ctx.organizationId))
    .orderBy(desc(skill.createdAt))) as SkillConfigRow[];
  const external = await listExternalSkills(ctx);
  const rows = [...internal, ...external];
  const decorated = await decorateResourceAccess(ctx, "skill", rows);
  // 普通成员的内部 Skill 只能看到已公开项；外部 Skill 已由资源授权表筛选。
  return ctx.role === "member"
    ? decorated.filter((row) => row.organizationId !== ctx.organizationId || row.resourceAccess.publicReadable === true)
    : decorated;
}

export async function getSkill(ctx: AuthContext, name: string): Promise<SkillConfigRowWithAccess | null> {
  const rows = await db
    .select()
    .from(skill)
    .where(and(eq(skill.organizationId, ctx.organizationId), eq(skill.name, name)))
    .limit(1);
  const internal = (rows[0] ?? null) as SkillConfigRow | null;
  if (internal) {
    const [decorated] = await decorateResourceAccess(ctx, "skill", [internal]);
    // 与列表行为一致：普通成员按名称读取内部非公开 Skill 时也应返回空。
    return ctx.role === "member" && !decorated.resourceAccess.publicReadable ? null : decorated;
  }

  const external = (await listExternalSkills(ctx)).find((row) => row.name === name);
  if (!external) return null;
  const canRead = await canReadResource(ctx, "skill", external.id, external.organizationId);
  if (!canRead) return null;
  const [decorated] = await decorateResourceAccess(ctx, "skill", [external]);
  return decorated;
}

export async function getSkillById(ctx: AuthContext, id: string): Promise<SkillConfigRowWithAccess | null> {
  const rows = await db.select().from(skill).where(eq(skill.id, id)).limit(1);
  const row = (rows[0] ?? null) as SkillConfigRow | null;
  if (!row) return null;

  if (row.organizationId === ctx.organizationId) {
    const [decorated] = await decorateResourceAccess(ctx, "skill", [row]);
    // 通过 ID 读取不能绕过普通成员对内部非公开 Skill 的限制。
    return ctx.role === "member" && !decorated.resourceAccess.publicReadable ? null : decorated;
  }

  const canRead = await canReadResource(ctx, "skill", row.id, row.organizationId);
  if (!canRead) return null;
  const [decorated] = await decorateResourceAccess(ctx, "skill", [row]);
  return decorated;
}

export async function getSkillByResourceKey(
  ctx: AuthContext,
  resourceKey: string,
): Promise<SkillConfigRowWithAccess | null> {
  const parsed = parseResourceKey(resourceKey);
  if (!parsed) return null;

  const rows = await db.select().from(skill).where(eq(skill.id, parsed.resourceUid)).limit(1);
  const row = (rows[0] ?? null) as SkillConfigRow | null;
  if (!row || row.organizationId !== parsed.sourceOrganizationId) return null;

  if (row.organizationId === ctx.organizationId) {
    const [decorated] = await decorateResourceAccess(ctx, "skill", [row]);
    // 资源键读取同样走内部公开状态校验，防止不同查询入口产生权限差异。
    return ctx.role === "member" && !decorated.resourceAccess.publicReadable ? null : decorated;
  }

  const canRead = await canReadResource(ctx, "skill", row.id, row.organizationId);
  if (!canRead) return null;

  const [decorated] = await decorateResourceAccess(ctx, "skill", [row]);
  return decorated;
}

export async function upsertSkill(
  ctx: AuthContext,
  name: string,
  data: SkillUpsertData,
  options: SkillSetOptions = {},
) {
  // 创建前也执行写入校验，避免普通成员借由“资源尚不存在”绕过后续更新校验。
  assertInternalWritable(ctx, "skill", name, ctx.organizationId);
  const existing = await db
    .select({ id: skill.id })
    .from(skill)
    .where(and(eq(skill.organizationId, ctx.organizationId), eq(skill.name, name)))
    .limit(1);

  const commonFields = {
    description: data.description,
    metadata: data.metadata ?? undefined,
    updatedAt: new Date(),
  };

  if (existing.length > 0) {
    assertInternalWritable(ctx, "skill", existing[0].id, ctx.organizationId);
    await db.update(skill).set(commonFields).where(eq(skill.id, existing[0].id));
    logger.info(
      `[SkillConfig] skill_write user=${ctx.userId} org=${ctx.organizationId} skill=${name} action=${options.auditAction ?? "set"} mode=update`,
    );
    if (options.publicReadable !== undefined) {
      await setPublicRead(ctx, "skill", ctx.organizationId, existing[0].id, options.publicReadable);
    }
    return existing[0].id;
  }

  const inserted = await db
    .insert(skill)
    .values({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      name,
      ...commonFields,
    })
    .returning({ id: skill.id });
  logger.info(
    `[SkillConfig] skill_write user=${ctx.userId} org=${ctx.organizationId} skill=${name} action=${options.auditAction ?? "set"} mode=insert`,
  );
  if (options.publicReadable !== undefined) {
    await setPublicRead(ctx, "skill", ctx.organizationId, inserted[0].id, options.publicReadable);
  }
  return inserted[0].id;
}

export async function deleteSkill(ctx: AuthContext, name: string): Promise<boolean> {
  const row = await getSkill(ctx, name);
  if (!row) return false;

  assertInternalWritable(ctx, "skill", row.id, row.organizationId);
  const result = await db.delete(skill).where(eq(skill.id, row.id)).returning({ id: skill.id });
  if (result.length > 0) {
    logger.info(`[SkillConfig] skill_delete user=${ctx.userId} org=${ctx.organizationId} skill=${name}`);
  }
  return result.length > 0;
}

export async function deleteSkillById(ctx: AuthContext, id: string): Promise<boolean> {
  const row = await getSkillById(ctx, id);
  if (!row) return false;

  assertInternalWritable(ctx, "skill", row.id, row.organizationId);
  const result = await db.delete(skill).where(eq(skill.id, row.id)).returning({ id: skill.id });
  if (result.length > 0) {
    logger.info(`[SkillConfig] skill_delete user=${ctx.userId} org=${ctx.organizationId} skill=${row.name}`);
  }
  return result.length > 0;
}
