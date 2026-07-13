推荐站点：https://linux.do/

# Navos Protocol Adapter

Navos Protocol Adapter 是一个面向本地/私有部署的 NavOS 协议适配服务。它把上游 NavOS 能力整理成 OpenAI 风格的 `/v1` 接口，并提供一个 Web 控制台来维护账号池、运行配置、YYDS Mail、图片/视频任务和注册队列。

这个项目常见的部署方式是：

```text
客户端 / Sub2Api
  -> Navos Protocol Adapter (/v1/*)
  -> 上游 NavOS / VIP 服务
```

## 能做什么

- OpenAI 风格模型代理：
  - `GET /v1/models`
  - `POST /v1/chat/completions`
  - `POST /v1/responses`
  - `POST /v1/messages`
- 图片生成：
  - `POST /v1/images/generations`
  - `GET /v1/images/generations/{taskId}`
- Seedance 视频生成：
  - `POST /v1/video/generations`
  - `GET /v1/video/generations/{taskId}`
- Web 控制台：
  - 账号池导入、启用、停用、冷却、余额刷新
  - 运行配置动态调整
  - YYDS Mail Key 与域名池配置
  - 批量注册任务创建、查询、取消

## 只配置 YYDS Mail 就能用吗？

不完全是。

YYDS Mail 只负责 **自动注册账号时的临时邮箱收码**。也就是说：

- 如果你已经有可用的 NavOS 账号，可以先在控制台手动导入账号，不需要先配置 YYDS Mail。
- 如果你希望系统自动注册/补充账号池，就需要在控制台配置 YYDS Mail Key。
- 服务启动本身仍然需要 `.env` 里的基础配置：管理密钥、公开代理密钥、上游地址、VIP HMAC、MySQL、Redis。

最小理解：

```text
.env 基础配置        -> 服务能启动
手动导入账号         -> 代理/图片/视频可以消耗账号
配置 YYDS Mail Key   -> 可以自动注册和补充账号池
```

## 环境要求

- Node.js 22+
- MySQL 8+
- Redis 7/8+
- Windows PowerShell、Linux Shell 或 Docker

## 快速开始：本地运行

### 1. 安装依赖

```powershell
npm ci
```

### 2. 创建 `.env`

```powershell
Copy-Item .env.example .env
```

打开 `.env`，至少填写这些项目：

```env
MASTER_API_KEY=sk-your-master-key
PUBLIC_PROXY_API_KEYS=sk-your-public-proxy-key
PROVIDER_BASE_URL=https://your-provider.example.com
VIP_HMAC_SECRET=your-vip-hmac-secret
VIP_BASE_URL=https://your-vip-api.example.com

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your-mysql-password
MYSQL_DATABASE=navos_new

REDIS_URL=redis://127.0.0.1:6379
QUEUE_PREFIX=navos

PORT=18888
PROVIDER_AUTH_MODE=uid-token
```

说明：

- `MASTER_API_KEY`：Web 控制台和 `/api/*` 管理接口使用。
- `PUBLIC_PROXY_API_KEYS`：给 Sub2Api 或普通客户端调用 `/v1/*` 使用，多个 key 用英文逗号分隔。
- `PROVIDER_BASE_URL`：上游 NavOS 服务地址。
- `VIP_HMAC_SECRET` / `VIP_BASE_URL`：注册和余额查询相关的 VIP 服务配置。
- `PROVIDER_ACCOUNT_UID` / `PROVIDER_ACCOUNT_TOKEN`：可选；如果你想启动时种一个默认账号，可以填写。

### 3. 启动后端

```powershell
npm run dev
```

默认监听：

```text
http://127.0.0.1:18888
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:18888/health
```

返回：

```json
{ "ok": true }
```

### 4. 启动 Web 控制台

另开一个终端：

```powershell
npm run dev:web
```

默认地址：

```text
http://127.0.0.1:15173
```

用 `.env` 里的 `MASTER_API_KEY` 登录。

## 首次使用流程

### 方式 A：已有账号，手动导入

1. 启动后端和 Web 控制台。
2. 登录控制台。
3. 进入「账号池」。
4. 导入账号 `uid` 和 `token`。
5. 使用 `/v1/*` 公开接口测试调用。

这种方式不要求先配置 YYDS Mail。

### 方式 B：自动注册账号池

1. 启动后端和 Web 控制台。
2. 登录控制台。
3. 进入「YYDS 配置」。
4. 保存 YYDS Mail Key。
5. 刷新/维护域名池。
6. 进入「账号池」或「注册任务」相关入口，创建批量注册任务。
7. 等待账号进入账号池后，再调用 `/v1/*`。

这种方式需要 YYDS Mail Key。

## 调用 `/v1` 接口

使用 `PUBLIC_PROXY_API_KEYS` 中的 key。

### 查看模型

```powershell
$headers = @{ Authorization = "Bearer sk-your-public-proxy-key" }
Invoke-RestMethod http://127.0.0.1:18888/v1/models -Headers $headers
```

### Chat Completions

```powershell
$headers = @{
  Authorization = "Bearer sk-your-public-proxy-key"
  "Content-Type" = "application/json"
}

$body = @{
  model = "gpt-5.5"
  messages = @(
    @{ role = "user"; content = "hello" }
  )
} | ConvertTo-Json -Depth 8

Invoke-RestMethod `
  -Uri http://127.0.0.1:18888/v1/chat/completions `
  -Method Post `
  -Headers $headers `
  -Body $body
```

### Responses

```powershell
$headers = @{
  Authorization = "Bearer sk-your-public-proxy-key"
  "Content-Type" = "application/json"
}

$body = @{
  model = "codex"
  input = "Say hello from Navos."
} | ConvertTo-Json -Depth 8

Invoke-RestMethod `
  -Uri http://127.0.0.1:18888/v1/responses `
  -Method Post `
  -Headers $headers `
  -Body $body
```

### 图片生成

```powershell
$headers = @{
  Authorization = "Bearer sk-your-public-proxy-key"
  "Content-Type" = "application/json"
}

$body = @{
  model = "gpt-image-2"
  prompt = "A cinematic cat astronaut, high detail"
  size = "1024x1024"
  n = 1
  response_format = "url"
} | ConvertTo-Json -Depth 8

Invoke-RestMethod `
  -Uri http://127.0.0.1:18888/v1/images/generations `
  -Method Post `
  -Headers $headers `
  -Body $body
```

### Seedance 视频生成

```powershell
$headers = @{
  Authorization = "Bearer sk-your-public-proxy-key"
  "Content-Type" = "application/json"
}

$body = @{
  model = "doubao-seedance-2-0-260128"
  prompt = "A cinematic city skyline at sunset, slow dolly-in camera movement."
  resolution = "720P"
  durationSeconds = 10
  aspectRatio = "16:9"
} | ConvertTo-Json -Depth 8

Invoke-RestMethod `
  -Uri http://127.0.0.1:18888/v1/video/generations `
  -Method Post `
  -Headers $headers `
  -Body $body
```

如果返回任务 ID，可以继续轮询：

```powershell
Invoke-RestMethod `
  -Uri http://127.0.0.1:18888/v1/video/generations/<task-id> `
  -Headers @{ Authorization = "Bearer sk-your-public-proxy-key" }
```

## Docker Compose

复制环境变量：

```powershell
Copy-Item .env.example .env
```

填写 `.env` 后，如果你要使用仓库自带的 `docker-compose.yml`，需要先准备外部网络：

```powershell
docker network create sub2api-deploy_sub2api-network
docker compose up -d --build
```

如果你不接 Sub2Api，只想单独运行 Navos，可以把 `docker-compose.yml` 里的 `sub2api-net` 外部网络删除或改成普通内部网络。

## 常用脚本

```powershell
npm run dev          # 启动后端开发服务
npm run dev:web      # 启动 Web 控制台
npm run build        # 构建后端和前端
npm run typecheck    # TypeScript 类型检查
npm test             # 运行测试
```

## 开发与测试状态

当前项目使用 Vitest 覆盖核心链路，包括：

- 鉴权与配置解析
- 模型代理
- 图片/视频协议
- 账号池与 MySQL 租约
- 运行配置
- YYDS Mail 与域名池
- BullMQ 注册队列
- Web 控制台基础交互

提交前建议运行：

```powershell
npm run typecheck
npm test
npm run build
```

## 安全提醒

- 不要提交 `.env`。
- 不要把 `MASTER_API_KEY` 和 `PUBLIC_PROXY_API_KEYS` 设置成同一个值。
- Web 控制台面向管理员，建议部署在内网、VPN 或可信网关后。
- `PUBLIC_PROXY_API_KEYS` 只给下游代理或可信客户端使用。
- 公开仓库前请轮换所有曾经出现在本地、日志、诊断报告或历史提交里的真实密钥。

## 许可证

本项目使用 MIT License。详见 [LICENSE](./LICENSE)。
