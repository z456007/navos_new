推荐站点：https://linux.do/
超级优秀的 AI 讨论社区

# Navos Protocol Adapter

Navos Protocol Adapter 是一个本地/私有部署的 NavOS 协议适配服务：对下游提供 OpenAI 风格 `/v1/*` 接口，对上游连接 NavOS / VIP 服务，并带一个 Web 控制台维护账号池、运行配置、YYDS Mail、图片/视频任务和注册队列。

## 开源版最快上手

这个仓库已经把普通用户需要的上游默认值写好：

- `PROVIDER_BASE_URL=https://navos-mind-server-backend.tec-do.com`
- `VIP_HMAC_SECRET=5c1d6c1dcd777dbe26f1422f03e5b3749ed87432`
- `VIP_BASE_URL=https://navos-mind-server-vip.tec-do.com`
- Docker Compose 会自动启动 MySQL、Redis、后端和 Web 控制台。

所以新用户通常只需要做三件事：

1. 复制 `.env.example` 为 `.env`。
2. 只需要改 `MASTER_API_KEY` 和 `PUBLIC_PROXY_API_KEYS`。
3. 启动后在 Web 控制台填写 YYDS Mail Key。

```powershell
Copy-Item .env.example .env
# 打开 .env，只改下面两个值：
# MASTER_API_KEY=你的管理后台 key
# PUBLIC_PROXY_API_KEYS=给下游 / Sub2Api 调用的 key，多个 key 用英文逗号分隔

docker compose up -d --build
```

启动后访问：

```text
Web 控制台：http://127.0.0.1:15173
后端接口：http://127.0.0.1:18888
健康检查：http://127.0.0.1:18888/health
```

登录 Web 控制台时使用 `.env` 里的 `MASTER_API_KEY`。
进入「YYDS 配置」保存 YYDS Mail Key 后，就可以使用自动注册/补号相关能力。
调用 `/v1/*` 时使用 `.env` 里的 `PUBLIC_PROXY_API_KEYS`。

## 它能做什么

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

## YYDS Mail 在哪里配置

YYDS Mail Key 不需要写进 `.env`，YYDS Mail Key 的填写位置就是 Web 控制台里的「YYDS 配置」。

正确流程：

1. `docker compose up -d --build` 启动服务。
2. 打开 `http://127.0.0.1:15173`。
3. 用 `MASTER_API_KEY` 登录。
4. 进入「YYDS 配置」。
5. 填写并保存 YYDS Mail Key。
6. 刷新/维护域名池。
7. 创建注册任务或让系统补充账号池。

如果你已经有可用 NavOS 账号，也可以先在控制台手动导入账号；只有自动注册/自动补号才需要 YYDS Mail Key。

## 调用 `/v1` 接口

把 `PUBLIC_PROXY_API_KEYS` 当作 Bearer Token 使用。

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

## 本地开发运行

如果不用 Docker，需要自己准备 Node.js 22+、MySQL 8+、Redis 7/8+。
`.env.example` 仍然是默认可用模板；开发时也只要求先改 `MASTER_API_KEY` 和 `PUBLIC_PROXY_API_KEYS`。

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

另开一个终端启动 Web 控制台：

```powershell
npm run dev:web
```

开发模式地址：

```text
后端：http://127.0.0.1:18888
Web 控制台：http://127.0.0.1:15173
```

## 常用脚本

```powershell
npm run dev          # 启动后端开发服务
npm run dev:web      # 启动 Web 控制台开发服务
npm run build        # 构建后端和前端
npm run typecheck    # TypeScript 类型检查
npm test             # 运行测试
```

## 技术选型一句话

TypeScript + Fastify + MySQL/Redis + React/Vite + Docker Compose：用一套 TypeScript 覆盖协议适配和控制台，Fastify 保持 API 层轻量高并发，MySQL/Redis 分别承载账号/配置持久化与队列状态，React/Vite 负责管理界面，Docker Compose 让开源用户最少配置即可启动整套依赖。

## 部署说明

- 默认端口：后端 `18888`，Web 控制台 `15173`。
- 如需改端口，可在 `.env` 里添加：
  - `NAVOS_BIND_PORT=18888`
  - `NAVOS_WEB_BIND_PORT=15173`
- Compose 不再依赖任何外部 Docker 网络；如果你要接入独立 Sub2Api，可以把 Sub2Api 容器加入 `sub2api-net`，通过 `navos-new:18888` 访问本服务。
- MySQL 默认密码 `navos-local-password` 是为了本地开箱即用；公开部署时可以按需修改，但不是首次运行必改项。

## 测试

提交前建议运行：

```powershell
npm run typecheck
npm test
npm run build
```

## 安全提醒

- 不要提交 `.env`。
- `MASTER_API_KEY` 和 `PUBLIC_PROXY_API_KEYS` 不要设置成同一个值。
- Web 控制台面向管理员，公网部署时建议放在内网、VPN 或可信网关后。
- `PUBLIC_PROXY_API_KEYS` 只给下游代理或可信客户端使用。

## 开源协议

本项目使用 MIT License，详见 [LICENSE](./LICENSE)。
