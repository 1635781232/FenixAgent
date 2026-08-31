import { AppError } from "../errors";
import type { AuthContext } from "../plugins/auth";
import { type IOrganizationRepo, organizationRepo } from "../repositories/organization";
import {
  type IResourcePermissionRepo,
  type ResourcePermissionAccessibleRow,
  type ResourcePermissionType,
  resourcePermissionRepo,
} from "../repositories/resource-permission";
import { authorizationSubjectFromAuthContext, requireAuthorization } from "./authorization-gateway";
import type { ResourceAccess, ResourceAccessInput } from "./config/types";

export const _deps: { repo: IResourcePermissionRepo; organizationRepo: IOrganizationRepo } = {
  organizationRepo,
  repo: resourcePermissionRepo,
};

export function _resetDeps() {
  _deps.organizationRepo = organizationRepo;
  _deps.repo = resourcePermissionRepo;
}

export function setResourcePermissionRepoForTesting(repo: IResourcePermissionRepo) {
  _deps.repo = repo;
}

export function setOrganizationRepoForTesting(repo: IOrganizationRepo) {
  _deps.organizationRepo = repo;
}

export function buildResourceAccess(
  ctx: AuthContext,
  resourceType: ResourcePermissionType,
  row: ResourceAccessInput,
  publicReadable?: boolean,
  sourceOrganizationName?: string,
): ResourceAccess {
  const internal = row.organizationId === ctx.organizationId;
  // Skill 的普通成员只能读取公开资源；owner/admin 仍沿用既有的组织内管理能力。
  const canManage = internal && (resourceType !== "skill" || ctx.role === "owner" || ctx.role === "admin");
  return {
    ownership: internal ? "internal" : "external",
    sourceOrganizationId: row.organizationId,
    sourceOrganizationName,
    resourceUid: row.id,
    resourceKey: `${row.organizationId}/${row.id}`,
    manageable: canManage,
    writable: canManage,
    publicReadable: internal ? publicReadable : undefined,
  };
}

export async function listReadableResourceRefs(ctx: AuthContext, resourceType: ResourcePermissionType) {
  const rows = await _deps.repo.listAccessibleForPrincipal(ctx.organizationId, resourceType);
  return rows.filter((row) => row.organizationId !== ctx.organizationId);
}

export async function getPublicReadMap(ctx: AuthContext, resourceType: ResourcePermissionType, resourceIds: string[]) {
  const idSet = new Set(resourceIds);
  const rows = await _deps.repo.listOwnedByOrganization(ctx.organizationId, resourceType);
  return new Map(rows.filter((row) => idSet.has(row.resourceId)).map((row) => [row.resourceId, row.hasPublicRead]));
}

export async function decorateResourceAccess<T extends ResourceAccessInput>(
  ctx: AuthContext,
  resourceType: ResourcePermissionType,
  rows: T[],
): Promise<(T & { resourceAccess: ResourceAccess })[]> {
  const internalIds = rows.filter((row) => row.organizationId === ctx.organizationId).map((row) => row.id);
  const publicReadMap = await getPublicReadMap(ctx, resourceType, internalIds);
  const organizationIds = [...new Set(rows.map((row) => row.organizationId))];
  const organizationNameMap = await _deps.organizationRepo.listNamesByIds(organizationIds);

  return rows.map((row) => ({
    ...row,
    resourceAccess: buildResourceAccess(
      ctx,
      resourceType,
      row,
      publicReadMap.get(row.id) ?? false,
      organizationNameMap.get(row.organizationId),
    ),
  }));
}

export async function setPublicRead(
  ctx: AuthContext,
  resourceType: ResourcePermissionType,
  ownerOrganizationId: string,
  resourceId: string,
  enabled: boolean,
) {
  // 先执行现有的资源归属和基础写入校验，避免企业策略绕过租户/组织边界。
  assertInternalWritable(ctx, resourceType, resourceId, ownerOrganizationId);
  if (resourceType === "skill") {
    // Skill 共享是企业受控动作；业务服务只提交统一请求，不直接依赖具体授权引擎。
    await requireAuthorization({
      subject: authorizationSubjectFromAuthContext(ctx),
      action: "skill:share",
      resource: {
        kind: "skill",
        id: resourceId,
        organizationId: ownerOrganizationId,
      },
    });
  }
  if (enabled) {
    return _deps.repo.createGrant({
      organizationId: ownerOrganizationId,
      resourceType,
      resourceId,
      principalType: "all",
      principalId: null,
      action: "read",
      createdBy: ctx.userId,
    });
  }
  return _deps.repo.deleteGrant({
    organizationId: ownerOrganizationId,
    resourceType,
    resourceId,
    principalType: "all",
    principalId: null,
    action: "read",
  });
}

export async function canReadResource(
  ctx: AuthContext,
  resourceType: ResourcePermissionType,
  resourceId: string,
  ownerOrganizationId: string,
) {
  // 读取授权仍以 PostgreSQL 资源授权表为事实来源；外部授权关系同步完成后再由独立迁移切片替换。
  const postgresAllowed =
    ownerOrganizationId === ctx.organizationId
      ? true
      : await _deps.repo.canReadExternalResource(ownerOrganizationId, resourceType, resourceId, ctx.organizationId);

  return postgresAllowed;
}

export function assertInternalWritable(
  ctx: AuthContext,
  resourceType: ResourcePermissionType,
  _resourceId: string,
  ownerOrganizationId: string,
) {
  // 外部资源始终只读，先于角色判断拒绝，防止跨组织写入。
  if (ownerOrganizationId !== ctx.organizationId) {
    throw new AppError("External resource is read-only", "FORBIDDEN", 403);
  }
  if (resourceType === "skill" && ctx.role === "member") {
    // 普通成员不能通过同组织关系获得 Skill 写入或共享能力。
    throw new AppError("Members have read-only access to public Skills", "FORBIDDEN", 403);
  }
}

export type { ResourcePermissionAccessibleRow, ResourcePermissionType };
