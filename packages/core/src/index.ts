import { defineContract } from "@fenix/plugin-sdk";
import { OrganizationService } from "./organization-service";
import { SkillService } from "./skill-service";

export {
  OrganizationService,
  type Department,
  type OrganizationMember,
  type OrganizationSnapshot,
} from "./organization-service";

export {
  SkillNotFoundError,
  SkillService,
  SkillValidationError,
  type CreateSkillInput,
  type Skill,
  type SkillRunResult,
  type SkillListQuery,
  type SkillStatus,
  type UpdateSkillInput,
} from "./skill-service";

/** Core 对 App 层公开的稳定业务能力。 */
export interface CoreFacade {
  status(): "ready";
  readonly organization: OrganizationService;
  readonly skills: SkillService;
}

export const CORE_FACADE = defineContract<CoreFacade>("fenix.core-facade", 1);

export function createCore(): CoreFacade {
  return Object.freeze({
    status: () => "ready",
    organization: new OrganizationService(),
    skills: new SkillService(),
  });
}
