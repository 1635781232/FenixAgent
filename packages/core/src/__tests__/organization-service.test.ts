import { describe, expect, test } from "bun:test";
import { OrganizationService } from "../organization-service";

describe("OrganizationService", () => {
  // 业务意图：演示组织固定包含一个主部门、两个下属部门以及各部门的一名成员。
  test("返回完整的三级成员归属关系", () => {
    const organization = new OrganizationService().snapshot();
    const root = organization.departments.find((department) => department.parentId === undefined);

    expect(root?.name).toBe("FenixAgent 事业部");
    expect(organization.departments.filter((department) => department.parentId === root?.id)).toHaveLength(2);
    expect(organization.members).toHaveLength(3);
    expect(new Set(organization.members.map((member) => member.departmentId)).size).toBe(3);
  });
});
