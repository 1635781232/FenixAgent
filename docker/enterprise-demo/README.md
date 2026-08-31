# 企业授权 Demo 环境

该环境用于本地验证 FenixAgent 企业授权 Demo 的外围依赖，不替换社区版的 `docker-compose.yml`。FenixAgent 应用仍在宿主机启动。

## 快速开始

### 启动基础设施

```powershell
Copy-Item .env.enterprise-demo.example .env.enterprise-demo
```

编辑 `.env.enterprise-demo`，替换所有示例密码和密钥后启动：

```powershell
docker compose --env-file .env.enterprise-demo -f docker-compose.enterprise-demo.yml up -d
```

检查容器状态：

```powershell
docker compose --env-file .env.enterprise-demo -f docker-compose.enterprise-demo.yml ps
```

该编排包含：

- FenixAgent PostgreSQL（宿主机端口 `5433`）
- Redis（宿主机端口 `6380`）
- OpenFGA、独立 PostgreSQL 和一次性数据库迁移任务
- MinIO

### 启动 FenixAgent 本地服务

基础设施健康后，在另一个终端执行：

```powershell
bun install
bun db:migrate
bun run dev
```

FenixAgent 默认服务地址为 <http://localhost:3000/>。

本地服务应加载 `.env.enterprise-demo` 中的 `DATABASE_URL`、`REDIS_URL`、`OPENFGA_API_URL` 与企业版 Feature 配置。当前 Demo 的应用侧授权、OIDC 账号桥接和 OpenFGA 模型发布仍需按开发步骤接入。

## 服务入口

| 服务 | 默认地址 | 说明 |
| --- | --- | --- |
| FenixAgent | <http://localhost:3000/> | 宿主机 `bun run dev` 启动 |
| OpenFGA HTTP API | <http://localhost:8080/> | OpenFGA HTTP API；根路径返回 Not Found 属正常现象 |
| MinIO API | <http://localhost:9000/> | S3 兼容接口 |
| MinIO Console | <http://localhost:9001/> | 对象存储管理界面 |

## 停止与清理

停止容器但保留数据卷：

```powershell
docker compose --env-file .env.enterprise-demo -f docker-compose.enterprise-demo.yml down
```

清理该 Demo 的全部容器和数据卷：

```powershell
docker compose --env-file .env.enterprise-demo -f docker-compose.enterprise-demo.yml down -v
```

`.env.enterprise-demo` 仅用于本机，包含真实密码和密钥，不应提交到 Git。

## 镜像拉取问题

若 `up -d` 在拉取镜像时失败，先检查 Docker Desktop 的镜像加速器或企业镜像仓库是否可访问。该编排使用固定镜像版本；不要为绕过拉取错误将镜像改为 `latest`。
