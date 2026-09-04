import {
  OpenFgaClient,
  type OpenFgaAuthorizationPort,
  type OpenFgaConfig,
  type OpenFgaFetch,
} from "@fenix/app-platform-openfga";
import {
  AUTHORIZATION_POLICY,
  type AccessDecision,
  type AppPrincipal,
  type AuthorizationPolicy,
  type FenixPlugin,
  type ResourceOperation,
  type ResourceSelector,
} from "@fenix/plugin-sdk";

export {
  SKILL_DEMO_ACTION_RELATIONS,
  bootstrapBundledOpenFgaSkillDemo,
  bootstrapOpenFgaSkillDemo,
  type OpenFgaAuthorizationModelDocument,
  type OpenFgaDemoBootstrapResult,
} from "./demo-bootstrap";

export const ENTERPRISE_OPENFGA_PLUGIN_ID = "enterprise.authorization.openfga-plugin";
export const ENTERPRISE_OPENFGA_POLICY_PROVIDER = "enterprise.authorization.openfga";

/** Enterprise OpenFGA Policy 的显式装配参数。 */
export interface EnterpriseOpenFgaAuthorizationOptions {
  readonly config: OpenFgaConfig;
  readonly actionRelations: Readonly<Record<string, string>>;
  readonly fetcher?: OpenFgaFetch;
}

function intersectRequestedIds(
  authorizedIds: readonly string[],
  requestedIds: readonly string[] | undefined,
): readonly string[] {
  if (requestedIds === undefined) return authorizedIds;
  const authorized = new Set(authorizedIds);
  return requestedIds.filter((id) => authorized.has(id));
}

function copyScopeTags(operation: ResourceOperation): ResourceSelector["scopeTags"] {
  return operation.scopeTags ? { ...operation.scopeTags } : undefined;
}

/**
 * Enterprise 唯一权限决策实现。
 *
 * 它把业务动作映射为 OpenFGA 关系，并统一输出 Core 可执行的 ids + scopeTags。
 */
export class EnterpriseOpenFgaAuthorizationPolicy implements AuthorizationPolicy {
  constructor(
    private readonly openFga: OpenFgaAuthorizationPort,
    private readonly actionRelations: Readonly<Record<string, string>>,
  ) {}

  async authorize(principal: AppPrincipal, operation: ResourceOperation): Promise<AccessDecision> {
    const relation = this.actionRelations[operation.action]?.trim();
    if (!relation) return { result: "deny", reason: `unmapped_action:${operation.action}` };

    const subject = `${principal.type?.trim() || "user"}:${principal.id}`;
    const selectorScopeTags = copyScopeTags(operation);

    if (operation.resourceId) {
      const allowed = await this.openFga.check({
        user: subject,
        relation,
        object: `${operation.resourceType}:${operation.resourceId}`,
      });
      if (!allowed) return { result: "deny", reason: `openfga_denied:${operation.action}` };
      return {
        result: "allow-filtered",
        selector: { ids: [operation.resourceId], scopeTags: selectorScopeTags },
      };
    }

    const objects = await this.openFga.listObjects({
      user: subject,
      relation,
      type: operation.resourceType,
    });
    const prefix = `${operation.resourceType}:`;
    const authorizedIds = objects
      .filter((object) => object.startsWith(prefix))
      .map((object) => object.slice(prefix.length));

    return {
      result: "allow-filtered",
      selector: {
        ids: intersectRequestedIds(authorizedIds, operation.requestedIds),
        scopeTags: selectorScopeTags,
      },
    };
  }
}

/** 创建显式安装的 Enterprise OpenFGA 授权插件。 */
export function createEnterpriseOpenFgaAuthorizationPlugin(
  options: EnterpriseOpenFgaAuthorizationOptions,
  replacesProvider: string,
): FenixPlugin {
  return {
    manifest: { id: ENTERPRISE_OPENFGA_PLUGIN_ID, version: "0.0.0" },
    async register(context) {
      const client = new OpenFgaClient(options.config, options.fetcher);
      await client.assertHealthy();
      context.contracts.replace(AUTHORIZATION_POLICY, {
        replacementId: ENTERPRISE_OPENFGA_POLICY_PROVIDER,
        replacesProvider,
        reason: "Enterprise uses OpenFGA as its only authorization decision source",
        value: new EnterpriseOpenFgaAuthorizationPolicy(client, options.actionRelations),
      });
    },
  };
}
