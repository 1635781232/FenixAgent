/** Skill 的可编辑业务数据，不包含权限、持久化或传输协议字段。 */
export interface Skill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly updatedAt: string;
}

export interface CreateSkillInput {
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
}

export interface UpdateSkillInput {
  readonly name?: string;
  readonly description?: string;
  readonly prompt?: string;
}

export interface SkillRunResult {
  readonly skillId: string;
  readonly output: string;
  readonly generatedAt: string;
}

/** 调用方可将该错误安全映射为 404，而无需识别存储实现。 */
export class SkillNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(skillId: string) {
    super(`Skill ${skillId} does not exist`);
  }
}

/** 领域输入不合法时的稳定错误，避免由下游存储层决定 API 行为。 */
export class SkillValidationError extends Error {
  readonly statusCode = 400;
}

function normalizeRequired(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) throw new SkillValidationError(`${fieldName} 不能为空`);
  return normalized;
}

function cloneSkill(skill: Skill): Skill {
  return { ...skill };
}

/**
 * 第一个纵向用例使用进程内存储，聚焦验证 Core 的领域边界。
 *
 * 后续接入数据库时，应以同样的业务契约替换此实现，而不让 HTTP 或 App 层直连数据源。
 */
export class SkillService {
  private readonly skills = new Map<string, Skill>();
  private nextId = 1;

  constructor() {
    this.seed({
      id: "skill-1",
      name: "会议纪要整理",
      description: "将零散会议记录整理为行动项清晰的结构化纪要。",
      prompt: "请根据以下会议记录，输出结论、待办事项、负责人和截止时间。",
    });
    this.nextId = 2;
  }

  list(): Skill[] {
    return [...this.skills.values()].map(cloneSkill);
  }

  get(skillId: string): Skill {
    return cloneSkill(this.getStored(skillId));
  }

  create(input: CreateSkillInput): Skill {
    const skill: Skill = {
      id: `skill-${this.nextId++}`,
      name: normalizeRequired(input.name, "Skill 名称"),
      description: normalizeRequired(input.description, "Skill 描述"),
      prompt: normalizeRequired(input.prompt, "Skill 提示词"),
      updatedAt: new Date().toISOString(),
    };
    this.skills.set(skill.id, skill);
    return cloneSkill(skill);
  }

  update(skillId: string, input: UpdateSkillInput): Skill {
    const existing = this.getStored(skillId);
    const skill: Skill = {
      ...existing,
      name: input.name === undefined ? existing.name : normalizeRequired(input.name, "Skill 名称"),
      description: input.description === undefined ? existing.description : normalizeRequired(input.description, "Skill 描述"),
      prompt: input.prompt === undefined ? existing.prompt : normalizeRequired(input.prompt, "Skill 提示词"),
      updatedAt: new Date().toISOString(),
    };
    this.skills.set(skillId, skill);
    return cloneSkill(skill);
  }

  delete(skillId: string): void {
    this.getStored(skillId);
    this.skills.delete(skillId);
  }

  run(skillId: string, source?: string): SkillRunResult {
    const skill = this.getStored(skillId);
    const material = source?.trim() || "未提供额外材料";
    return {
      skillId,
      generatedAt: new Date().toISOString(),
      output: `已按“${skill.name}”执行。提示词：${skill.prompt} 输入：${material}`,
    };
  }

  private seed(input: Omit<Skill, "updatedAt">): void {
    this.skills.set(input.id, { ...input, updatedAt: new Date().toISOString() });
  }

  private getStored(skillId: string): Skill {
    const skill = this.skills.get(skillId);
    if (!skill) throw new SkillNotFoundError(skillId);
    return skill;
  }
}
