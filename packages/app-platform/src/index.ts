import type {
  Contract,
  ContractRegistryPort,
  ContractReplacement,
  FenixPlugin,
  PluginContext,
} from "@fenix/plugin-sdk";

/** App 装配层向发行版入口转发插件公开类型，避免 App 直接依赖 SDK。 */
export type { FenixPlugin } from "@fenix/plugin-sdk";

interface Binding {
  readonly version: number;
  readonly providerId: string;
  readonly value: unknown;
}

/** 进程内单 Provider 契约容器。 */
export class ContractRegistry implements ContractRegistryPort {
  private readonly bindings = new Map<string, Binding>();

  bind<T>(contract: Contract<T>, providerId: string, value: T): void {
    if (!providerId.trim()) throw new Error("Provider id must not be empty");
    if (this.bindings.has(contract.id)) throw new Error(`Contract ${contract.id} already has a provider`);
    this.bindings.set(contract.id, { version: contract.version, providerId, value });
  }

  replace<T>(contract: Contract<T>, replacement: ContractReplacement<T>): void {
    const current = this.bindings.get(contract.id);
    if (!current) throw new Error(`Contract ${contract.id} has no provider to replace`);
    if (current.providerId !== replacement.replacesProvider) {
      throw new Error(`Contract ${contract.id} is provided by ${current.providerId}`);
    }
    if (!replacement.reason.trim()) throw new Error("Replacement reason must not be empty");
    this.bindings.set(contract.id, {
      version: contract.version,
      providerId: replacement.replacementId,
      value: replacement.value,
    });
  }

  resolve<T>(contract: Contract<T>): T {
    const binding = this.bindings.get(contract.id);
    if (!binding) throw new Error(`Contract ${contract.id} has no provider`);
    if (binding.version !== contract.version) throw new Error(`Contract ${contract.id} version mismatch`);
    return binding.value as T;
  }

  providerId<T>(contract: Contract<T>): string | undefined {
    return this.bindings.get(contract.id)?.providerId;
  }
}

/** 显式插件数组的启动期宿主。 */
export class PluginHost {
  private readonly plugins = new Map<string, FenixPlugin>();
  private initialized = false;

  register(plugins: readonly FenixPlugin[]): void {
    if (this.initialized) throw new Error("Plugin host has already started");
    for (const plugin of plugins) {
      if (this.plugins.has(plugin.manifest.id)) throw new Error(`Duplicate plugin ${plugin.manifest.id}`);
      this.plugins.set(plugin.manifest.id, plugin);
    }
  }

  async initialize(context: PluginContext): Promise<void> {
    if (this.initialized) throw new Error("Plugin host has already started");
    for (const plugin of this.orderedPlugins()) await plugin.register(context);
    this.initialized = true;
  }

  private orderedPlugins(): FenixPlugin[] {
    const result: FenixPlugin[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`Plugin dependency cycle at ${id}`);
      const plugin = this.plugins.get(id);
      if (!plugin) throw new Error(`Missing required plugin ${id}`);
      visiting.add(id);
      for (const requiredId of plugin.manifest.requires ?? []) visit(requiredId);
      visiting.delete(id);
      visited.add(id);
      result.push(plugin);
    };

    for (const id of this.plugins.keys()) visit(id);
    return result;
  }
}

interface ProviderRequirement {
  readonly contract: Contract<unknown>;
  readonly providerId: string;
}

/** 纯装配用 Builder，不包含 Route、数据库或任何领域服务。 */
export class FenixAppBuilder {
  readonly contracts = new ContractRegistry();
  private readonly plugins = new PluginHost();
  private readonly requirements: ProviderRequirement[] = [];
  private started = false;

  bind<T>(contract: Contract<T>, providerId: string, value: T): void {
    this.assertNotStarted();
    this.contracts.bind(contract, providerId, value);
  }

  registerPlugins(plugins: readonly FenixPlugin[]): void {
    this.assertNotStarted();
    this.plugins.register(plugins);
  }

  requireProvider<T>(contract: Contract<T>, providerId: string): void {
    this.assertNotStarted();
    this.requirements.push({ contract, providerId });
  }

  async start(): Promise<void> {
    this.assertNotStarted();
    await this.plugins.initialize({ contracts: this.contracts });
    for (const requirement of this.requirements) {
      const current = this.contracts.providerId(requirement.contract);
      if (current !== requirement.providerId) {
        throw new Error(`Required provider ${requirement.providerId} is missing`);
      }
    }
    this.started = true;
  }

  private assertNotStarted(): void {
    if (this.started) throw new Error("Application has already started");
  }
}

export function createFenixApp(): FenixAppBuilder {
  return new FenixAppBuilder();
}
