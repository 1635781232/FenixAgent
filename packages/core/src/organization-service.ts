/** 部门层级中的一个业务部门。 */
export interface Department {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string;
}

/** 成员在组织中的展示信息；role 仅表示岗位角色，不参与权限判断。 */
export interface OrganizationMember {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly departmentId: string;
}

/** 前端展示组织结构所需的只读快照。 */
export interface OrganizationSnapshot {
  readonly departments: readonly Department[];
  readonly members: readonly OrganizationMember[];
}

const DEPARTMENTS: readonly Department[] = Object.freeze([
  Object.freeze({ id: "department-headquarters", name: "FenixAgent 事业部" }),
  Object.freeze({ id: "department-product", name: "产品部", parentId: "department-headquarters" }),
  Object.freeze({ id: "department-development", name: "开发部", parentId: "department-headquarters" }),
]);

const MEMBERS: readonly OrganizationMember[] = Object.freeze([
  Object.freeze({
    id: "alice",
    name: "Alice",
    role: "事业部负责人",
    departmentId: "department-headquarters",
  }),
  Object.freeze({
    id: "bob",
    name: "Bob",
    role: "产品经理",
    departmentId: "department-product",
  }),
  Object.freeze({
    id: "carol",
    name: "Carol",
    role: "开发工程师",
    departmentId: "department-development",
  }),
]);

/**
 * 提供当前架构演示所需的固定组织数据。
 *
 * 该服务不解释角色权限，也不依赖授权 Provider；后续接入持久化时可在不改变 App 调用方式的前提下替换实现。
 */
export class OrganizationService {
  snapshot(): OrganizationSnapshot {
    return {
      departments: DEPARTMENTS.map((department) => ({ ...department })),
      members: MEMBERS.map((member) => ({ ...member })),
    };
  }
}
