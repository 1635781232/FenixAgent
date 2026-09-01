import { COMMUNITY_PROFILE_PROVIDER, DISTRIBUTION_PROFILE } from "@fenix/community-app-kit";
import type { FenixPlugin } from "@fenix/plugin-sdk";

export const ENTERPRISE_PROFILE_PLUGIN_ID = "enterprise.profile.plugin";
export const ENTERPRISE_PROFILE_PROVIDER = "enterprise.profile.default";

/** 只用于验证 Enterprise 能通过公开契约替换 Community Provider。 */
export const enterpriseProfilePlugin: FenixPlugin = {
  manifest: { id: ENTERPRISE_PROFILE_PLUGIN_ID, version: "0.0.0" },
  register(context) {
    context.contracts.replace(DISTRIBUTION_PROFILE, {
      replacementId: ENTERPRISE_PROFILE_PROVIDER,
      replacesProvider: COMMUNITY_PROFILE_PROVIDER,
      reason: "Validate enterprise provider replacement",
      value: { edition: "enterprise" },
    });
  },
};
