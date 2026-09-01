/** OpenFGA 连接所需的显式配置。 */
export interface OpenFgaConfig {
  readonly apiUrl: string;
  readonly storeId: string;
  readonly authorizationModelId: string;
  readonly apiToken?: string;
}

/** OpenFGA 单资源关系判断输入。 */
export interface OpenFgaCheckInput {
  readonly user: string;
  readonly relation: string;
  readonly object: string;
}

/** OpenFGA 反向资源查询输入。 */
export interface OpenFgaListObjectsInput {
  readonly user: string;
  readonly relation: string;
  readonly type: string;
}

/** Enterprise Policy 使用的 OpenFGA 技术端口。 */
export interface OpenFgaAuthorizationPort {
  check(input: OpenFgaCheckInput): Promise<boolean>;
  listObjects(input: OpenFgaListObjectsInput): Promise<readonly string[]>;
}

export type OpenFgaFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function required(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} 不能为空`);
  return normalized;
}

function normalizeConfig(config: OpenFgaConfig): OpenFgaConfig {
  return Object.freeze({
    apiUrl: required(config.apiUrl, "OpenFGA apiUrl").replace(/\/+$/, ""),
    storeId: required(config.storeId, "OpenFGA storeId"),
    authorizationModelId: required(config.authorizationModelId, "OpenFGA authorizationModelId"),
    apiToken: config.apiToken?.trim() || undefined,
  });
}

/** OpenFGA HTTP 适配器；只封装引擎协议，不包含业务动作映射。 */
export class OpenFgaClient implements OpenFgaAuthorizationPort {
  private readonly config: OpenFgaConfig;

  constructor(config: OpenFgaConfig, private readonly fetcher: OpenFgaFetch = fetch) {
    this.config = normalizeConfig(config);
  }

  /** Enterprise 启动阶段验证 OpenFGA 服务可达。 */
  async assertHealthy(): Promise<void> {
    const response = await this.fetcher(`${this.config.apiUrl}/healthz`, {
      headers: this.headers(false),
    });
    if (!response.ok) throw new Error(`OpenFGA health check failed: HTTP ${response.status}`);
  }

  async check(input: OpenFgaCheckInput): Promise<boolean> {
    const body = await this.post(`/stores/${encodeURIComponent(this.config.storeId)}/check`, {
      authorization_model_id: this.config.authorizationModelId,
      tuple_key: {
        user: required(input.user, "OpenFGA check user"),
        relation: required(input.relation, "OpenFGA check relation"),
        object: required(input.object, "OpenFGA check object"),
      },
    });
    if (typeof body.allowed !== "boolean") throw new Error("OpenFGA check response is missing allowed");
    return body.allowed;
  }

  async listObjects(input: OpenFgaListObjectsInput): Promise<readonly string[]> {
    const body = await this.post(`/stores/${encodeURIComponent(this.config.storeId)}/list-objects`, {
      authorization_model_id: this.config.authorizationModelId,
      user: required(input.user, "OpenFGA listObjects user"),
      relation: required(input.relation, "OpenFGA listObjects relation"),
      type: required(input.type, "OpenFGA listObjects type"),
    });
    if (!Array.isArray(body.objects) || !body.objects.every((item) => typeof item === "string")) {
      throw new Error("OpenFGA listObjects response is missing objects");
    }
    return body.objects;
  }

  private async post(path: string, payload: unknown): Promise<Record<string, unknown>> {
    const response = await this.fetcher(`${this.config.apiUrl}${path}`, {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const details = (await response.text()).trim();
      throw new Error(`OpenFGA request failed: HTTP ${response.status}${details ? ` ${details}` : ""}`);
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("OpenFGA response must be a JSON object");
    }
    return body as Record<string, unknown>;
  }

  private headers(json: boolean): Headers {
    const headers = new Headers();
    if (json) headers.set("content-type", "application/json");
    if (this.config.apiToken) headers.set("authorization", `Bearer ${this.config.apiToken}`);
    return headers;
  }
}
