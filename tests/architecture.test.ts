import { describe, expect, test } from "bun:test";
import { createFenixApp } from "@fenix/app-platform";
import { createCommunityApp } from "@fenix/community-app";
import { createCommunitySkillApplication, DISTRIBUTION_PROFILE } from "@fenix/community-app-kit";
import { createEnterpriseApp } from "@fenix/enterprise-app";
import { defineContract, type FenixPlugin } from "@fenix/plugin-sdk";

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
}

async function readDependencies(packagePath: string): Promise<string[]> {
  const manifest = (await Bun.file(packagePath).json()) as PackageManifest;
  return Object.keys(manifest.dependencies ?? {}).sort();
}

describe("V4 架构与 Skill 用例", () => {
  // Community App 只注册 Community Base，不依赖任何企业插件。
  test("Community 发行版使用 Community Provider", async () => {
    const app = createCommunityApp();
    await app.start();

    expect(app.contracts.resolve(DISTRIBUTION_PROFILE)).toEqual({ edition: "community" });
  });

  // Community App 获取业务用例时，仍须经由 Community Kit 装配并完成启动校验。
  test("Community Kit 暴露已装配的 Skill 业务用例", async () => {
    const application = createCommunitySkillApplication();
    await application.start();

    expect(application.skills.list()).toHaveLength(1);
  });

  // Enterprise App 复用 Community Base，并通过显式插件替换公开契约。
  test("Enterprise 发行版替换 Community Provider", async () => {
    const app = createEnterpriseApp();
    await app.start();

    expect(app.contracts.resolve(DISTRIBUTION_PROFILE)).toEqual({ edition: "enterprise" });
  });

  // PluginHost 必须按声明依赖排序，传入数组顺序不能影响初始化顺序。
  test("插件按依赖顺序初始化", async () => {
    const events: string[] = [];
    const base: FenixPlugin = {
      manifest: { id: "base", version: "0.0.0" },
      register: () => {
        events.push("base");
      },
    };
    const extension: FenixPlugin = {
      manifest: { id: "extension", version: "0.0.0", requires: ["base"] },
      register: () => {
        events.push("extension");
      },
    };
    const app = createFenixApp();
    app.registerPlugins([extension, base]);

    await app.start();

    expect(events).toEqual(["base", "extension"]);
  });

  // 发行版声明的必需 Provider 缺失时必须阻止启动。
  test("缺少必需 Provider 时启动失败", async () => {
    const contract = defineContract<{ value: string }>("test.required", 1);
    const app = createFenixApp();
    app.bind(contract, "community.provider", { value: "community" });
    app.requireProvider(contract, "enterprise.provider");

    await expect(app.start()).rejects.toThrow("Required provider enterprise.provider is missing");
  });

  // 发行版依赖清单必须严格遵守架构图，禁止 Community App 越层依赖底层包。
  test("发行版依赖关系严格符合目标架构", async () => {
    expect(await readDependencies("apps/community-app/package.json")).toEqual(["@fenix/community-app-kit"]);
    expect(await readDependencies("apps/enterprise-app/package.json")).toEqual([
      "@fenix-enterprise/profile-plugin",
      "@fenix/app-platform",
      "@fenix/community-app-kit",
      "@fenix/core",
    ]);
    expect(await readDependencies("packages/community-app-kit/package.json")).toEqual([
      "@fenix/app-platform",
      "@fenix/core",
      "@fenix/plugin-sdk",
    ]);
    expect(await readDependencies("packages/core/package.json")).toEqual(["@fenix/plugin-sdk"]);
    expect(await readDependencies("packages/app-platform/package.json")).toEqual(["@fenix/plugin-sdk"]);
  });
});
