import { ENTERPRISE_PROFILE_PROVIDER, enterpriseProfilePlugin } from "@fenix-enterprise/profile-plugin";
import { createFenixApp, type FenixPlugin } from "@fenix/app-platform";
import { DISTRIBUTION_PROFILE, registerCommunityBase } from "@fenix/community-app-kit";
import { createCore } from "@fenix/core";

/** Enterprise 发行版先注册 Community Base，再显式装配私有插件。 */
export function createEnterpriseApp(additionalPlugins: readonly FenixPlugin[] = []) {
  const app = createFenixApp();
  registerCommunityBase(app, createCore());
  app.registerPlugins([enterpriseProfilePlugin, ...additionalPlugins]);
  app.requireProvider(DISTRIBUTION_PROFILE, ENTERPRISE_PROFILE_PROVIDER);
  return app;
}
