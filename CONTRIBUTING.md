# 参与贡献

欢迎提交 Issue 与 Pull Request。缺陷与讨论请发到 [GitHub Issues](https://github.com/Justin-sky/ai-art-engine/issues)（[Gitee Issues](https://gitee.com/beijing_blue_whale_era_zhangjian/ai-art-engine/issues) 同样受理）。

## 开发环境

需要 Node.js 22+。安装包自带 Node 运行时，终端用户无需安装。

```bash
npm install
npm run dev                     # 开发模式启动
npm run typecheck && npm test   # 类型检查 + 单元测试，提交 PR 前请确保通过
npm run pack                    # 输出未封装目录，便于自测
npm run dist:win                # 打包 Windows（dist:mac / dist:linux 同理）
npm run site                    # 本地预览官网与文档（website/）
```

架构与扩展点见 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) 与 [`docs/README.md`](./docs/README.md)。

## 常见环境问题

**Electron 下载失败**：切换镜像后重新安装。

```bash
set ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/
node node_modules/electron/install.js
```

**`npm run dev` 后窗口不出现**：`npm run dev` 经 [`scripts/dev-launcher.mjs`](./scripts/dev-launcher.mjs) 启动，会先处理两类问题（需要原始行为时用 `npm run dev:raw`）：

1. 继承来的 `ELECTRON_RUN_AS_NODE` 会让主进程以纯 Node 模式运行，表现为报 `Cannot read properties of undefined (reading 'isPackaged')` 后退出。启动器会清掉该变量。
2. 工作区被打上低完整性标签（常见于强沙箱的 agent 宿主）时，Electron 无法建立 Chromium 沙箱，会以 `0x80000003` 静默中止。启动器会把工作区与 electron 解包目录重置为中等完整性。

标签问题也可以单独处理：

```powershell
npm run fix:integrity              # 重置为中等完整性
npm run fix:integrity -- --check   # 只查看当前标签
```

自动重置因权限不足失败时，手动执行 `icacls "<目录>" /setintegritylevel M /T /C`，或把 electron 解包目录移到工作区外并用 `ELECTRON_OVERRIDE_DIST_PATH` 指向它。

## 发版

版本号以 `package.json` 的 `version` 为准（SemVer）。

1. 更新 `package.json` 与 [`CHANGELOG.md`](./CHANGELOG.md) 并提交。
2. 打 tag 并推送，CI 会校验 tag 与 `package.json` 一致后构建并发布 GitHub Release（含自动更新元数据）。

```bash
git tag v7.3.0
git push origin v7.3.0
```

客户端以 GitHub Release 为更新源；开发模式不检查更新。
