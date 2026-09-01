import { defineContract } from "@fenix/plugin-sdk";

/** 纯架构验证用 Core Facade，不包含 Agent、用户、组织或权限业务。 */
export interface CoreFacade {
  status(): "ready";
}

export const CORE_FACADE = defineContract<CoreFacade>("fenix.core-facade", 1);

export function createCore(): CoreFacade {
  return Object.freeze({ status: () => "ready" });
}
