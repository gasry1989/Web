# 前端开发环境搭建指南

## 1. 前置要求
- Node.js >= 18.x (LTS)
- Git 已安装
- 推荐 IDE：VS Code（或 WebStorm）
  - VS Code 推荐插件：
    - ESLint
    - Prettier
    - Highlight Matching Tag
    - Live Server (可选)
    - Path Intellisense

## 2. Clone 仓库
```bash
git clone https://github.com/gasry1989/MyFile.git
cd MyFile
```

## 3. 创建目录并粘贴代码
把回答中提供的所有文件按结构建立（index.html, main.js, styles/, modules/, bootstrap/, config/ 等）。

## 4. 启动本地静态服务器
方式一：使用任意裸 HTTP 服务器（推荐 npx serve）
```bash
npm init -y              # 仅第一次
npm install serve --save-dev
npx serve .              # 默认 3000 端口
# 浏览器访问 http://localhost:3000
```

方式二：使用 VS Code 插件 “Live Server”
- 右键 index.html -> Open with Live Server

方式三：写一个极简 Node server (可选)
```bash
node -e "require('http').createServer((r,s)=>{r.url==='/'&&(r.url='/index.html');require('fs').readFile('.'+r.url,(e,d)=>{if(e){s.writeHead(404);s.end('NF')}else{s.end(d)} })}).listen(3000)"
```

## 5. 目录核对
```
/index.html
/main.js
/bootstrap/...
/config/env.js
/styles/...
/modules/...
```

## 6. 登录测试
1. 启动后访问 http://localhost:3000
2. 路由跳转到 #/login
3. 使用后端提供的测试账号登录（需后端已开放 3.1），成功后跳转用户管理。

## 7. 修改 API 地址
如需切换到测试环境，在 config/env.js 中替换：
```js
API_BASE: 'http://media.szdght.com:11180'
```
若未来改为 https，请同步改：
```js
WS_URL: 'wss://media.szdght.com:11180/ws'
```

## 8. WebSocket 调试
当前仅建立空连接 + 模式模拟。进入现场管理页面（#/site）时自动 ensureConnected()。
后续接入真实模式数据时：
- 替换 openModePreview 中的模拟逻辑为真正发送 cmd
- 在 wsClient.onCmd('modeDataResponse', handler) 中合并数据

## 9. 性能监测（简易）
在浏览器控制台可以加：
```js
performance.mark('start');
// ... 某些操作 ...
performance.mark('end');
performance.measure('操作耗时','start','end');
performance.getEntriesByType('measure');
```

## 10. 常见问题
| 问题 | 可能原因 | 解决 |
|------|----------|------|
| 登录 401 | token 失效 / 凭证错误 | 确认账号和后端返回 |
| 地图不显示 | 高德脚本未加载 / Key 不正确 | 检查控制台是否有 AMap 错误 |
| 视频窗口一直“连接中” | 此阶段是模拟，需接入真实 WebRTC | 后续替换播放器封装 |
| “最多同时打开 X 个窗口” | 达到容量 | 关闭一个窗口或扩大浏览器宽度 |

## 11. 下一步开发建议
- 替换视频占位为真实 SRS / WebRTC JS
- 引入 ESLint + Prettier (npm i -D eslint prettier)
- 添加错误码统一映射（3005 等）

## 12. 风格与命名约定
- 模块内函数统一使用小驼峰
- 事件总线事件名使用 “域:动作:细分” 形式
- 所有 DOM query 前加语义 id/class，避免深层级选择器

若需要把本骨架迁移到 Vue：
- 保留 api / ws / state 逻辑，逐步将渲染函数迁移为组件
- 预览窗口、模式模拟器拆成 Vue 组件即可
