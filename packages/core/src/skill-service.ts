import type { ResourceSelector } from "@fenix/plugin-sdk";

/** Skill 的可编辑业务数据，不包含权限、持久化或传输协议字段。 */
export type SkillStatus = "draft" | "published";

export interface Skill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly status: SkillStatus;
  readonly updatedAt: string;
}

export interface CreateSkillInput {
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly status?: SkillStatus;
}

export interface UpdateSkillInput {
  readonly name?: string;
  readonly description?: string;
  readonly prompt?: string;
  readonly status?: SkillStatus;
}

/** Skill 列表的纯业务过滤条件，不包含权限范围。 */
export interface SkillListQuery {
  readonly keyword?: string;
  readonly status?: SkillStatus;
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
      name: "会议纪要助手",
      description: "将零散会议记录整理为行动项清晰的结构化纪要。",
      prompt: "请根据以下会议记录，输出结论、待办事项、负责人和截止时间。",
      status: "published",
    });
    this.seed({
      id: "skill-2",
      name: "开发辅助助手",
      description: "将开发任务拆分为可执行步骤，并给出验证建议。",
      prompt: "请分析以下开发任务，输出实现步骤、风险和测试清单。",
      status: "published",
    });
    this.seed({
      id: "skill-3",
      name: "API 审核助手",
      description: "检查接口设计的一致性、错误处理和兼容性。",
      prompt: "请审核以下 API 设计，并列出兼容性和可维护性问题。",
      status: "draft",
    });
    this.seed({
      id: "skill-4",
      name: "需求澄清助手",
      description: "从需求材料中识别歧义、缺失条件和待确认事项。",
      prompt: "请分析以下需求，列出歧义、风险和需要业务方确认的问题。",
      status: "published",
    });
    this.seed({
      id: "skill-5",
      name: "用户故事生成器",
      description: "将产品想法整理为用户故事与验收标准。",
      prompt: "请将以下产品想法整理为用户故事、验收标准和优先级建议。",
      status: "draft",
    });
    this.seed({
      id: "skill-6",
      name: "代码审查助手",
      description: "检查代码变更中的可维护性、边界条件与测试遗漏。",
      prompt: "请审查以下代码变更，按严重程度列出问题和修改建议。",
      status: "published",
    });
    this.seed({
      id: "skill-7",
      name: "测试用例设计助手",
      description: "根据功能说明生成正常、异常和边界测试用例。",
      prompt: "请为以下功能生成分层测试用例，并标注前置条件和预期结果。",
      status: "published",
    });
    this.seed({
      id: "skill-8",
      name: "发布说明助手",
      description: "将版本变更整理为面向用户的发布说明。",
      prompt: "请根据以下变更记录生成简洁的发布说明和升级注意事项。",
      status: "draft",
    });
    this.seed({
      id: "skill-9",
      name: "故障复盘助手",
      description: "把故障时间线整理为根因、影响与改进措施。",
      prompt: "请根据以下故障记录生成时间线、根因分析和行动项。",
      status: "published",
    });
    this.seed({
      id: "skill-10",
      name: "数据字典助手",
      description: "根据表结构草稿生成字段解释和数据约束。",
      prompt: "请为以下数据结构生成字段字典、约束和示例值。",
      status: "draft",
    });
    this.seed({
      id: "skill-11",
      name: "模型评测助手",
      description: "为模型能力设计评测维度、样例和评分规则。",
      prompt: "请针对以下模型场景设计评测集、指标和评分标准。",
      status: "draft",
    });
    this.seed({
      id: "skill-12",
      name: "安全检查助手",
      description: "识别方案中的数据暴露、越权和配置风险。",
      prompt: "请检查以下方案的安全风险，并给出可验证的整改建议。",
      status: "draft",
    });
    this.nextId = 13;
  }

  list(query: SkillListQuery = {}, selector: ResourceSelector = {}): Skill[] {
    const keyword = query.keyword?.trim().toLocaleLowerCase();
    const selectedIds = selector.ids ? new Set(selector.ids) : undefined;
    return [...this.skills.values()]
      .filter((skill) => selectedIds === undefined || selectedIds.has(skill.id))
      .filter((skill) => query.status === undefined || skill.status === query.status)
      .filter((skill) => {
        if (!keyword) return true;
        return `${skill.name}\n${skill.description}\n${skill.prompt}`.toLocaleLowerCase().includes(keyword);
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(cloneSkill);
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
      status: input.status ?? "draft",
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
      status: input.status ?? existing.status,
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
