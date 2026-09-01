import {
  ENTERPRISE_OPENFGA_POLICY_PROVIDER,
  createEnterpriseOpenFgaAuthorizationPlugin,
  type EnterpriseOpenFgaAuthorizationOptions,
} from "@fenix-enterprise/openfga-authorization-plugin";
import { ENTERPRISE_PROFILE_PROVIDER, enterpriseProfilePlugin } from "@fenix-enterprise/profile-plugin";
import { AUTHORIZATION_POLICY, createFenixApp, type FenixPlugin } from "@fenix/app-platform";
import { DISTRIBUTION_PROFILE, registerCommunityBase } from "@fenix/community-app-kit";
import { createCore } from "@fenix/core";

/** Enterprise 发行版的显式装配参数。 */
export interface EnterpriseAppOptions {
  readonly openFga: EnterpriseOpenFgaAuthorizationOptions;
  readonly additionalPlugins?: readonly FenixPlugin[];
}

/** Enterprise 发行版强制装配 OpenFGA，缺少唯一授权 Provider 时启动失败。 */
export function createEnterpriseApp(options: EnterpriseAppOptions) {
  const app = createFenixApp();
  registerCommunityBase(app, createCore());
  app.registerPlugins([
    enterpriseProfilePlugin,
    createEnterpriseOpenFgaAuthorizationPlugin(options.openFga),
    ...(options.additionalPlugins ?? []),
  ]);
  app.requireProvider(DISTRIBUTION_PROFILE, ENTERPRISE_PROFILE_PROVIDER);
  app.requireProvider(AUTHORIZATION_POLICY, ENTERPRISE_OPENFGA_POLICY_PROVIDER);
  return app;
}
