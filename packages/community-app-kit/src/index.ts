import { createFenixApp, type FenixAppBuilder } from "@fenix/app-platform";
import { CORE_FACADE, type CoreFacade, createCore } from "@fenix/core";
import { defineContract, type FenixPlugin } from "@fenix/plugin-sdk";

/** 仅用于验证发行版 Provider 替换，不表达任何业务能力。 */
export interface DistributionProfile {
  readonly edition: "community" | "enterprise" | "customer";
}

export const DISTRIBUTION_PROFILE = defineContract<DistributionProfile>("fenix.distribution-profile", 1);
export const COMMUNITY_CORE_PROVIDER = "community.core.default";
export const COMMUNITY_PROFILE_PROVIDER = "community.profile.default";

/** Community 固定基础能力的普通注册函数，不是插件。 */
export function registerCommunityBase(app: FenixAppBuilder, core: CoreFacade): void {
  app.bind(CORE_FACADE, COMMUNITY_CORE_PROVIDER, core);
  app.bind(DISTRIBUTION_PROFILE, COMMUNITY_PROFILE_PROVIDER, { edition: "community" });
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
