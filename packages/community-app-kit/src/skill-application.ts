import type {
  CreateSkillInput,
  Skill,
  SkillListQuery,
  SkillResourceService,
  SkillRunResult,
  UpdateSkillInput,
} from "@fenix/core";
import { defineContract, type AppPrincipal } from "@fenix/plugin-sdk";

/** Skill 列表及过滤前候选数量，供共享页面展示发行版差异。 */
export interface SkillListResult {
  readonly skills: readonly Skill[];
  readonly candidateCount: number;
}

/** 页面可使用的 Skill 单资源能力，不代替服务端业务操作中的强制校验。 */
export interface SkillCapabilities {
  readonly canEdit: boolean;
  readonly canDelete: boolean;
}

/**
 * Community 与 Enterprise 共同实现的 Skill 应用契约。
 *
 * 契约接收可信主体，但不规定角色、OpenFGA relation 或具体授权策略。
 */
export interface SkillApplication {
  list(principal: AppPrincipal, query?: SkillListQuery): Promise<SkillListResult>;
  create(principal: AppPrincipal, input: CreateSkillInput): Promise<Skill>;
  capabilities(principal: AppPrincipal, skillId: string): Promise<SkillCapabilities>;
  get(principal: AppPrincipal, skillId: string): Promise<Skill>;
  update(principal: AppPrincipal, skillId: string, input: UpdateSkillInput): Promise<Skill>;
  delete(principal: AppPrincipal, skillId: string): Promise<void>;
  run(principal: AppPrincipal, skillId: string, source?: string): Promise<SkillRunResult>;
}

/** Enterprise Skill 插件可显式替换的 Community Skill 应用契约。 */
export const SKILL_APPLICATION = defineContract<SkillApplication>("community.skill-application", 1);

export const COMMUNITY_SKILL_APPLICATION_PROVIDER = "community.skill.application.default";

/** Community 的基础 Skill 实现；只编排 Core，不包含企业权限动作。 */
export class CommunitySkillApplication implements SkillApplication {
  constructor(private readonly skills: SkillResourceService) {}

  async list(_principal: AppPrincipal, query: SkillListQuery = {}): Promise<SkillListResult> {
    const skills = this.skills.list(query);
    return { skills, candidateCount: skills.length };
  }

  async create(_principal: AppPrincipal, input: CreateSkillInput): Promise<Skill> {
    return this.skills.create(input);
  }

  async capabilities(_principal: AppPrincipal, skillId: string): Promise<SkillCapabilities> {
    this.skills.get(skillId);
    return { canEdit: true, canDelete: true };
  }

  async get(_principal: AppPrincipal, skillId: string): Promise<Skill> {
    return this.skills.get(skillId);
  }

  async update(_principal: AppPrincipal, skillId: string, input: UpdateSkillInput): Promise<Skill> {
    return this.skills.update(skillId, input);
  }

  async delete(_principal: AppPrincipal, skillId: string): Promise<void> {
    this.skills.delete(skillId);
  }

  async run(_principal: AppPrincipal, skillId: string, source?: string): Promise<SkillRunResult> {
    return this.skills.run(skillId, source);
  }
}
