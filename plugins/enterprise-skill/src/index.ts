import { AuthorizedOperationExecutor } from "@fenix/app-platform";
import {
  COMMUNITY_SKILL_APPLICATION_PROVIDER,
  SKILL_APPLICATION,
  type SkillApplication,
  type SkillCapabilities,
  type SkillListResult,
} from "@fenix/community-app-kit";
import {
  SKILL_RESOURCE_SERVICE,
  type CreateSkillInput,
  type Skill,
  type SkillListQuery,
  type SkillResourceService,
  type SkillRunResult,
  type UpdateSkillInput,
} from "@fenix/core";
import {
  AUTHORIZATION_POLICY,
  type AppPrincipal,
  type FenixPlugin,
} from "@fenix/plugin-sdk";

export const ENTERPRISE_SKILL_PLUGIN_ID = "enterprise.skill.plugin";
export const ENTERPRISE_SKILL_APPLICATION_PROVIDER = "enterprise.skill.application";

/** Enterprise Skill 插件使用的稳定业务权限编码，不包含 OpenFGA relation。 */
export const ENTERPRISE_SKILL_PERMISSIONS = Object.freeze({
  CREATE: "skill:create",
  USE: "skill:use",
  EDIT: "skill:edit",
  DELETE: "skill:delete",
});

/** Enterprise Skill 插件的显式替换参数。 */
export interface EnterpriseSkillPluginOptions {
  readonly replacesProvider?: string;
  readonly authorizationPluginId: string;
}

/**
 * Enterprise Skill 应用实现。
 *
 * 它只使用统一授权端口和 Core Skill 契约，不感知 OpenFGA Store、模型或 relation。
 */
export class EnterpriseSkillApplication implements SkillApplication {
  constructor(
    private readonly skills: SkillResourceService,
    private readonly authorization: AuthorizedOperationExecutor,
  ) {}

  async list(principal: AppPrincipal, query: SkillListQuery = {}): Promise<SkillListResult> {
    const candidates = this.skills.list(query);
    return this.authorization.run(
      principal,
      {
        resourceType: "skill",
        action: ENTERPRISE_SKILL_PERMISSIONS.USE,
        requestedIds: candidates.map((skill) => skill.id),
      },
      async ({ selector }) => ({
        skills: this.skills.list(query, selector),
        candidateCount: candidates.length,
      }),
    );
  }

  async create(principal: AppPrincipal, input: CreateSkillInput): Promise<Skill> {
    return this.authorization.run(
      principal,
      {
        resourceType: "skill_space",
        resourceId: "shared-space",
        action: ENTERPRISE_SKILL_PERMISSIONS.CREATE,
      },
      async () => this.skills.create(input),
    );
  }

  async capabilities(principal: AppPrincipal, skillId: string): Promise<SkillCapabilities> {
    this.skills.get(skillId);
    const [canEdit, canDelete] = await Promise.all([
      this.authorization.check(principal, {
        resourceType: "skill",
        resourceId: skillId,
        action: ENTERPRISE_SKILL_PERMISSIONS.EDIT,
      }),
      this.authorization.check(principal, {
        resourceType: "skill",
        resourceId: skillId,
        action: ENTERPRISE_SKILL_PERMISSIONS.DELETE,
      }),
    ]);
    return { canEdit, canDelete };
  }

  async get(principal: AppPrincipal, skillId: string): Promise<Skill> {
    return this.authorization.run(
      principal,
      {
        resourceType: "skill",
        resourceId: skillId,
        action: ENTERPRISE_SKILL_PERMISSIONS.USE,
      },
      async ({ selector }) => this.skills.get(skillId, selector),
    );
  }

  async update(
    principal: AppPrincipal,
    skillId: string,
    input: UpdateSkillInput,
  ): Promise<Skill> {
    return this.authorization.run(
      principal,
      {
        resourceType: "skill",
        resourceId: skillId,
        action: ENTERPRISE_SKILL_PERMISSIONS.EDIT,
      },
      async ({ selector }) => this.skills.update(skillId, input, selector),
    );
  }

  async delete(principal: AppPrincipal, skillId: string): Promise<void> {
    return this.authorization.run(
      principal,
      {
        resourceType: "skill",
        resourceId: skillId,
        action: ENTERPRISE_SKILL_PERMISSIONS.DELETE,
      },
      async ({ selector }) => this.skills.delete(skillId, selector),
    );
  }

  async run(principal: AppPrincipal, skillId: string, source?: string): Promise<SkillRunResult> {
    return this.authorization.run(
      principal,
      {
        resourceType: "skill",
        resourceId: skillId,
        action: ENTERPRISE_SKILL_PERMISSIONS.USE,
      },
      async ({ selector }) => this.skills.run(skillId, source, selector),
    );
  }
}

/** 创建显式替换 Community Skill 应用实现的 Enterprise 插件。 */
export function createEnterpriseSkillPlugin(options: EnterpriseSkillPluginOptions): FenixPlugin {
  return {
    manifest: {
      id: ENTERPRISE_SKILL_PLUGIN_ID,
      version: "0.0.0",
      requires: [options.authorizationPluginId],
    },
    register(context) {
      const skills = context.contracts.resolve(SKILL_RESOURCE_SERVICE);
      const policy = context.contracts.resolve(AUTHORIZATION_POLICY);
      context.contracts.replace(SKILL_APPLICATION, {
        replacementId: ENTERPRISE_SKILL_APPLICATION_PROVIDER,
        replacesProvider: options.replacesProvider ?? COMMUNITY_SKILL_APPLICATION_PROVIDER,
        reason: "Enterprise Skill adds OpenFGA-backed authorization and resource filtering",
        value: new EnterpriseSkillApplication(skills, new AuthorizedOperationExecutor(policy)),
      });
    },
  };
}
