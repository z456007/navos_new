import { resolve, sep } from "node:path";

const adminAssetRoot = resolve(process.cwd(), "dist-admin", "assets");

export function adminPageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Navos 控制台</title>
  <link rel="stylesheet" href="/admin/assets/admin.css">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/admin/assets/admin.js"></script>
</body>
</html>`;
}

export function resolveAdminAsset(file: string): string | undefined {
  if (file.includes("/") || file.includes("\\") || file.includes("..")) {
    return undefined;
  }
  const filePath = resolve(adminAssetRoot, file);
  return filePath.startsWith(`${adminAssetRoot}${sep}`) ? filePath : undefined;
}

export function adminAssetContentType(file: string): string {
  if (file.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (file.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (file.endsWith(".svg")) {
    return "image/svg+xml";
  }
  return "application/octet-stream";
}
