import { describe, expect, test } from "bun:test";
import { SkillNotFoundError, SkillService, SkillValidationError } from "../skill-service";

describe("SkillService", () => {
  // 创建、编辑、运行和删除应通过同一领域服务完成，避免 App 层维护第二份状态。
  test("管理 Skill 的完整生命周期", () => {
    const service = new SkillService();
    const created = service.create({
      name: "需求澄清助手",
      description: "将需求讨论提炼为待确认事项。",
      prompt: "识别歧义并提出澄清问题。",
    });

    const updated = service.update(created.id, { name: "需求分析助手" });
    const result = service.run(created.id, "需要支持多租户导出");
    service.delete(created.id);

    expect(updated.name).toBe("需求分析助手");
    expect(result.output).toContain("需求分析助手");
    expect(() => service.get(created.id)).toThrow(SkillNotFoundError);
  });

  // 空白业务字段必须在领域边界拒绝，不能交给 HTTP 页面或未来存储层兜底。
  test("拒绝创建空白 Skill", () => {
    const service = new SkillService();

    expect(() =>
      service.create({ name: " ", description: "有效描述", prompt: "有效提示词" }),
    ).toThrow(SkillValidationError);
  });

  // 关键字与状态过滤属于纯业务查询，并与统一授权 selector 在 Core 查询中求交集。
  test("按照关键字和状态过滤 Skill", () => {
    const service = new SkillService();

    expect(service.list({ keyword: "开发", status: "published" }).map((skill) => skill.name)).toEqual([
      "开发辅助助手",
    ]);
    expect(service.list({ status: "draft" })).toHaveLength(6);
    expect(service.list({ status: "draft" }).map((skill) => skill.name)).toContain("API 审核助手");
    expect(service.list({}, { ids: ["skill-2", "skill-7"] }).map((skill) => skill.id).sort()).toEqual([
      "skill-2",
      "skill-7",
    ]);
  });
});
