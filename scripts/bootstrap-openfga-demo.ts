import { bootstrapBundledOpenFgaSkillDemo } from "@fenix-enterprise/openfga-authorization-plugin";

const apiUrl = process.env.OPENFGA_API_URL?.trim() || "http://127.0.0.1:8080";
const result = await bootstrapBundledOpenFgaSkillDemo(apiUrl);

console.log(
  JSON.stringify(
    {
      message: "OpenFGA 权限模型和演示关系已写入数据存储",
      storeName: result.storeName,
      storeId: result.config.storeId,
      authorizationModelId: result.config.authorizationModelId,
      tupleCount: result.tupleCount,
    },
    null,
    2,
  ),
);
