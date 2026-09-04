import {
  AUTHORIZATION_POLICY,
  createFenixApp,
  type FenixAppBuilder,
} from "@fenix/app-platform";
import { CORE_FACADE, type CoreFacade, createCore } from "@fenix/core";
import { SKILL_RESOURCE_SERVICE } from "@fenix/core";
import {
  defineContract,
  type AccessDecision,
  type AppPrincipal,
  type AuthorizationPolicy,
  type FenixPlugin,
  type ResourceOperation,
} from "@fenix/plugin-sdk";

export {
  startSkillDemoServer,
  type SkillDemoRuntime,
  type SkillDemoServerOptions,
} from "./skill-demo-server";

export {
  COMMUNITY_SKILL_APPLICATION_PROVIDER,
  CommunitySkillApplication,
  SKILL_APPLICATION,
  type SkillApplication,
  type SkillCapabilities,
  type SkillListResult,
} from "./skill-application";

import {
  COMMUNITY_SKILL_APPLICATION_PROVIDER,
  CommunitySkillApplication,
  SKILL_APPLICATION,
  type SkillApplication,
} from "./skill-application";

/** 仅用于验证发行版 Provider 替换，不表达任何业务能力。 */
export interface DistributionProfile {
  readonly edition: "community" | "enterprise" | "customer";
}

export const DISTRIBUTION_PROFILE = defineContract<DistributionProfile>("fenix.distribution-profile", 1);
export const COMMUNITY_CORE_PROVIDER = "community.core.default";
export const COMMUNITY_PROFILE_PROVIDER = "community.profile.default";
export const COMMUNITY_AUTHORIZATION_POLICY_PROVIDER = "community.authorization.allow-all";
export const CORE_SKILL_RESOURCE_PROVIDER = "core.skill.resource-service.default";

/**
 * Community 版授权策略仍执行统一接口，但不缩小业务资源范围。
 *
 * 返回候选 IDs 而非绕过授权层，使 Enterprise 替换 Provider 后可以保持完全相同的业务调用链。
 */
export class CommunityAllowAllAuthorizationPolicy implements AuthorizationPolicy {
  async authorize(_principal: AppPrincipal, operation: ResourceOperation): Promise<AccessDecision> {
    const ids = operation.resourceId ? [operation.resourceId] : operation.requestedIds;
    if (ids === undefined) return { result: "allow-all" };
    return {
      result: "allow-filtered",
      selector: {
        ids: [...ids],
        scopeTags: operation.scopeTags ? { ...operation.scopeTags } : undefined,
      },
    };
  }
}

/** Community App 使用的最小业务入口，不暴露 Core 的构造细节。 */
export interface CommunitySkillRuntime {
  readonly edition: "community";
  readonly authorizationProvider: string;
  readonly skillProvider: string;
  readonly organization: CoreFacade["organization"];
  readonly skills: SkillApplication;
  start(): Promise<void>;
}

/** Community 固定基础能力的普通注册函数，不是插件。 */
export function registerCommunityBase(app: FenixAppBuilder, core: CoreFacade): void {
  app.bind(CORE_FACADE, COMMUNITY_CORE_PROVIDER, core);
  app.bind(SKILL_RESOURCE_SERVICE, CORE_SKILL_RESOURCE_PROVIDER, core.skills);
  app.bind(DISTRIBUTION_PROFILE, COMMUNITY_PROFILE_PROVIDER, { edition: "community" });
  app.bind(
    AUTHORIZATION_POLICY,
    COMMUNITY_AUTHORIZATION_POLICY_PROVIDER,
    new CommunityAllowAllAuthorizationPolicy(),
  );
  app.bind(
    SKILL_APPLICATION,
    COMMUNITY_SKILL_APPLICATION_PROVIDER,
    new CommunitySkillApplication(core.skills),
  );
}

/**
 * 创建 Community 发行版的完整基础装配。
 *
 * Community App 只调用该入口，不感知 Core 和 App Platform 的构造细节。
 */
export function createCommunityApplication(optionalPlugins: readonly FenixPlugin[] = []): FenixAppBuilder {
  const app = createFenixApp();
  registerCommunityBase(app, createCore());
  app.registerPlugins(optionalPlugins);
  app.requireProvider(DISTRIBUTION_PROFILE, COMMUNITY_PROFILE_PROVIDER);
  return app;
}

/**
 * 创建 Community 的 Skill 业务用例。
 *
 * App 只获取业务服务与启动函数；Core、Provider 与插件宿主仍由 Kit 统一装配。
 */
export function createCommunitySkillApplication(): CommunitySkillRuntime {
  const core = createCore();
  const app = createFenixApp();
  registerCommunityBase(app, core);
  app.requireProvider(DISTRIBUTION_PROFILE, COMMUNITY_PROFILE_PROVIDER);
  app.requireProvider(AUTHORIZATION_POLICY, COMMUNITY_AUTHORIZATION_POLICY_PROVIDER);
  return Object.freeze({
    edition: "community" as const,
    get authorizationProvider() {
      return app.contracts.providerId(AUTHORIZATION_POLICY) ?? "unbound";
    },
    get skillProvider() {
      return app.contracts.providerId(SKILL_APPLICATION) ?? "unbound";
    },
    organization: core.organization,
    get skills() {
      return app.contracts.resolve(SKILL_APPLICATION);
    },
    start: () => app.start(),
  });
}
