import type { AuthorizationCheckInput, AuthorizationPlugin } from "@fenix/authorization-plugin";
import { createLogger } from "@fenix/logger";
import authorizationModel from "../model/authorization-model.json";

const logger = createLogger("openfga-authorization-plugin");

/** OpenFGA 服务端连接与模型定位配置。 */
export interface OpenFgaAuthorizationPluginConfig {
  apiUrl: string;
  storeId: string;
  authorizationModelId: string;
  timeoutMs?: number;
}

/** OpenFGA Check API 使用的 tuple 结构。 */
export interface OpenFgaCheckTuple {
  user: string;
  relation: string;
  object: string;
}

/** OpenFGA Check 使用的临时关系事实。 */
export interface OpenFgaContextualTuples {
  tuple_keys: OpenFgaCheckTuple[];
}

/**
 * 企业 OpenFGA 模型的映射边界。
 *
 * 客户已有 OpenFGA 时，仅替换 mapper 和 Store/模型配置，不修改 FenixAgent 业务模块。
 */
export interface OpenFgaMapper {
  toCheckTuple(input: AuthorizationCheckInput): OpenFgaCheckTuple | undefined;
  toContextualTuples?(input: AuthorizationCheckInput): OpenFgaContextualTuples | undefined;
}

/**
 * 插件构造选项。
 *
 * `fetchFn` 只用于隔离 HTTP 边界和测试，不由业务模块传入；生产环境使用运行时原生 fetch。
 */
export interface OpenFgaAuthorizationPluginOptions {
  mapper?: OpenFgaMapper;
  fetchFn?: OpenFgaFetch;
}

interface OpenFgaCheckResponse {
  allowed?: boolean;
}

type OpenFgaFetch = (input: string, init: RequestInit) => Promise<Response>;

const ACTION_RELATIONS: Record<string, { relation: string; resourceKind: "skill" | "skill_space" }> = {
  "skill:create": { relation: "can_create_skill", resourceKind: "skill_space" },
  "skill:read": { relation: "can_read", resourceKind: "skill" },
  "skill:edit": { relation: "can_edit", resourceKind: "skill" },
  "skill:use": { relation: "can_use", resourceKind: "skill" },
  "skill:review": { relation: "can_review", resourceKind: "skill" },
  "skill:publish": { relation: "can_publish", resourceKind: "skill" },
  "skill:delete": { relation: "can_delete", resourceKind: "skill" },
  "skill:share": { relation: "can_share", resourceKind: "skill" },
};

/**
 * FenixAgent 自有模型的默认映射。
 *
 * 当前资源共享不支持跨组织授权，先在映射层拒绝不同组织的请求，防止模型或 tuple 配置错误时
 * 出现跨租户放行。未来若明确支持跨组织协作，应替换为包含组织关系验证的专用 mapper。
 */
export const defaultOpenFgaMapper: OpenFgaMapper = {
  toCheckTuple(input) {
    if (input.subject.organizationId !== input.resource.organizationId) return;
    const mapping = ACTION_RELATIONS[input.action];
    if (!mapping || input.resource.kind !== mapping.resourceKind) return;
    return {
      user: `user:${input.subject.id}`,
      relation: mapping.relation,
      object: `${input.resource.kind}:${input.resource.id}`,
    };
  },
  toContextualTuples(input) {
    // 组织 owner/admin 是认证系统的可信事实。关系投影尚未接入前，仅在本次 Check 中传入，
    // 使 OpenFGA 仍按模型推导 can_share，而非由 Core 直接绕过授权。后续由 Outbox 同步
    // organization#org_owner/org_admin 和 skill#organization 后可删除该临时上下文。
    if (
      input.action !== "skill:share" ||
      input.resource.kind !== "skill" ||
      input.subject.organizationId !== input.resource.organizationId ||
      (input.subject.organizationRole !== "owner" && input.subject.organizationRole !== "admin")
    ) {
      return;
    }

    return {
      tuple_keys: [
        {
          user: `organization:${input.resource.organizationId}`,
          relation: "organization",
          object: `skill:${input.resource.id}`,
        },
        {
          user: `user:${input.subject.id}`,
          relation: input.subject.organizationRole === "owner" ? "org_owner" : "org_admin",
          object: `organization:${input.subject.organizationId}`,
        },
      ],
    };
  },
};

/**
 * OpenFGA 授权插件。
 *
 * 插件无本地策略缓存：每次判断都访问指定 Store，因此多实例部署不会出现进程间策略状态不一致。
 * OpenFGA 超时、网络异常、非 2xx 和未知动作均返回 false；是否转换为 HTTP 403 由 Core 门面处理。
 */
export class OpenFgaAuthorizationPlugin implements AuthorizationPlugin {
  constructor(
    private readonly config: OpenFgaAuthorizationPluginConfig,
    options: OpenFgaAuthorizationPluginOptions = {},
  ) {
    this.mapper = options.mapper ?? defaultOpenFgaMapper;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private readonly mapper: OpenFgaMapper;
  private readonly fetchFn: OpenFgaFetch;

  /** 将业务授权请求转换为 OpenFGA Check；外部依赖异常按最小权限原则拒绝。 */
  async check(input: AuthorizationCheckInput): Promise<boolean> {
    const tupleKey = this.mapper.toCheckTuple(input);
    if (!tupleKey) {
      // 未产生 tuple 表示默认映射已在本地拒绝，例如跨组织或未登记的动作；此时没有调用 OpenFGA。
      logger.info("OpenFGA authorization check skipped", {
        action: input.action,
        resourceKind: input.resource.kind,
        reason: "mapper_rejected",
      });
      return false;
    }
    const contextualTuples = this.mapper.toContextualTuples?.(input);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 1500);
    try {
      const response = await this.fetchFn(
        `${this.config.apiUrl.replace(/\/$/, "")}/stores/${encodeURIComponent(this.config.storeId)}/check`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            authorization_model_id: this.config.authorizationModelId,
            tuple_key: tupleKey,
            ...(contextualTuples ? { contextual_tuples: contextualTuples } : {}),
          }),
        },
      );
      if (!response.ok) {
        logger.warn("OpenFGA authorization request failed", {
          status: response.status,
          action: input.action,
          resourceKind: input.resource.kind,
        });
        return false;
      }
      const result = (await response.json()) as OpenFgaCheckResponse;
      const allowed = result.allowed === true;
      // 每个实际 Check 都记录结果，可据此确认请求是否进入 OpenFGA；避免记录用户、资源和 tuple 标识。
      logger.info("OpenFGA authorization check completed", {
        action: input.action,
        resourceKind: input.resource.kind,
        allowed,
      });
      return allowed;
    } catch (error) {
      logger.warn("OpenFGA authorization unavailable", {
        action: input.action,
        resourceKind: input.resource.kind,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Demo 与部署工具发布的模型；Core 不导入此引擎专属结构。 */
export { authorizationModel };

/**
 * OpenFGA 插件的部署入口。
 *
 * OpenFGA 连接地址、Store 和模型标识全部由本插件读取，Core 不保存或校验这些引擎专属配置。
 */
export function createAuthorizationPlugin(): AuthorizationPlugin {
  const apiUrl = requireOpenFgaEnvironment("RCS_OPENFGA_API_URL");
  const storeId = requireOpenFgaEnvironment("RCS_OPENFGA_STORE_ID");
  const authorizationModelId = requireOpenFgaEnvironment("RCS_OPENFGA_MODEL_ID");

  try {
    const url = new URL(apiUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error("RCS_OPENFGA_API_URL must be an absolute HTTP(S) URL");
  }

  return new OpenFgaAuthorizationPlugin({ apiUrl, storeId, authorizationModelId });
}

/** 仅由 OpenFGA 插件读取的必填部署变量，缺失时拒绝启动而不是回退为放行。 */
function requireOpenFgaEnvironment(
  name: "RCS_OPENFGA_API_URL" | "RCS_OPENFGA_STORE_ID" | "RCS_OPENFGA_MODEL_ID",
): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when loading the OpenFGA authorization plugin`);
  return value;
}
