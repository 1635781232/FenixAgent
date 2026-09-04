import { startSkillDemoServer } from "@fenix/community-app-kit";
import {
  SKILL_DEMO_ACTION_RELATIONS,
  bootstrapBundledOpenFgaSkillDemo,
} from "@fenix-enterprise/openfga-authorization-plugin";
import { createEnterpriseSkillApplication } from "./index";

const apiUrl = process.env.OPENFGA_API_URL?.trim() || "http://127.0.0.1:8080";
const bootstrap = await bootstrapBundledOpenFgaSkillDemo(apiUrl);
const runtime = createEnterpriseSkillApplication({
  openFga: {
    config: bootstrap.config,
    actionRelations: SKILL_DEMO_ACTION_RELATIONS,
  },
});

const port = optionalPort(process.env.PORT) ?? 3402;
await startSkillDemoServer(runtime, { port });

console.log(
  `OpenFGA demo ready: store=${bootstrap.config.storeId} model=${bootstrap.config.authorizationModelId} tuples=${bootstrap.tupleCount}`,
);

function optionalPort(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT 必须是 1 至 65535 的整数");
  }
  return port;
}
