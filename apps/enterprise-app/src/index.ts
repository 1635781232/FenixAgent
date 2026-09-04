import {
  ENTERPRISE_OPENFGA_POLICY_PROVIDER,
  ENTERPRISE_OPENFGA_PLUGIN_ID,
  createEnterpriseOpenFgaAuthorizationPlugin,
  type EnterpriseOpenFgaAuthorizationOptions,
} from "@fenix-enterprise/openfga-authorization-plugin";
import {
  ENTERPRISE_SKILL_APPLICATION_PROVIDER,
  createEnterpriseSkillPlugin,
} from "@fenix-enterprise/skill-plugin";
import { ENTERPRISE_PROFILE_PROVIDER, enterpriseProfilePlugin } from "@fenix-enterprise/profile-plugin";
import {
  AUTHORIZATION_POLICY,
  createFenixApp,
  type FenixAppBuilder,
  type FenixPlugin,
} from "@fenix/app-platform";
import {
  COMMUNITY_AUTHORIZATION_POLICY_PROVIDER,
  COMMUNITY_SKILL_APPLICATION_PROVIDER,
  DISTRIBUTION_PROFILE,
  SKILL_APPLICATION,
  registerCommunityBase,
  type SkillDemoRuntime,
} from "@fenix/community-app-kit";
import { createCore, type CoreFacade } from "@fenix/core";

/** Enterprise 发行版的显式装配参数。 */
export interface EnterpriseAppOptions {
  readonly openFga: EnterpriseOpenFgaAuthorizationOptions;
  readonly additionalPlugins?: readonly FenixPlugin[];
}

/** Enterprise Skill 演示运行时；业务服务不包含任何 OpenFGA 类型或关系名。 */
export interface EnterpriseSkillRuntime extends SkillDemoRuntime {
  readonly edition: "enterprise";
}

/** Enterprise 发行版强制装配 OpenFGA，缺少唯一授权 Provider 时启动失败。 */
export function createEnterpriseApp(options: EnterpriseAppOptions) {
  const app = createFenixApp();
  configureEnterpriseApplication(app, createCore(), options);
  return app;
}

/** 创建由 OpenFGA 唯一决策、但复用 Community 业务和页面的 Enterprise 用例。 */
export function createEnterpriseSkillApplication(
  options: EnterpriseAppOptions,
): EnterpriseSkillRuntime {
  const core = createCore();
  const app = createFenixApp();
  configureEnterpriseApplication(app, core, options);
  return Object.freeze({
    edition: "enterprise" as const,
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

function configureEnterpriseApplication(
  app: FenixAppBuilder,
  core: CoreFacade,
  options: EnterpriseAppOptions,
): void {
  registerCommunityBase(app, core);
  app.registerPlugins([
    enterpriseProfilePlugin,
    createEnterpriseOpenFgaAuthorizationPlugin(options.openFga, COMMUNITY_AUTHORIZATION_POLICY_PROVIDER),
    createEnterpriseSkillPlugin({
      replacesProvider: COMMUNITY_SKILL_APPLICATION_PROVIDER,
      authorizationPluginId: ENTERPRISE_OPENFGA_PLUGIN_ID,
    }),
    ...(options.additionalPlugins ?? []),
  ]);
  app.requireProvider(DISTRIBUTION_PROFILE, ENTERPRISE_PROFILE_PROVIDER);
  app.requireProvider(AUTHORIZATION_POLICY, ENTERPRISE_OPENFGA_POLICY_PROVIDER);
  app.requireProvider(SKILL_APPLICATION, ENTERPRISE_SKILL_APPLICATION_PROVIDER);
}
