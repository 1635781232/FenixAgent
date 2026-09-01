import { defineContract } from "@fenix/plugin-sdk";
import { SkillService } from "./skill-service";

export {
  SkillNotFoundError,
  SkillService,
  SkillValidationError,
  type CreateSkillInput,
  type Skill,
  type SkillRunResult,
  type UpdateSkillInput,
} from "./skill-service";

/** Core 对 App 层公开的稳定业务能力。 */
export interface CoreFacade {
  status(): "ready";
  readonly skills: SkillService;
}

export const CORE_FACADE = defineContract<CoreFacade>("fenix.core-facade", 1);

export function createCore(): CoreFacade {
  return Object.freeze({ status: () => "ready", skills: new SkillService() });
}
