# magpie agent 插件 MusePi 接入 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布一个 magpie agent 插件，让 MusePi 出现在 magpie 的 Agents 页并可一键接上 magpie 网关。

**Architecture:** 单个零依赖 ESM 模块 `musepi.agent.js`，导出 `agent` 描述与 `connect()`；magpie 的 `agentplug` 用内置 moejs 加载它，把 `connect` 返回的键路径写入 `~/.musepi/agent/models.yml`，把选中的模型写入 `~/.musepi/agent/config.yml` 的 `modelRoles.default`，断开时按 stash 逐字恢复。

**Tech Stack:** 纯 JavaScript（ESM）、`node --test`、magpie agent 插件契约（`internal/agentplug`）。

**Spec:** `docs/design.md`

## Global Constraints

- 插件仓库独立于 MusePi，路径 `D:/Projects/Agents/magpie-agent-musepi`，独立 git 仓库。
- 零运行时依赖：模块在 moejs 中执行，不得 import 任何包或 Node 内置模块。
- 只导出 `agent`（对象）与 `connect`（函数），ESM（`"type": "module"`）。
- `agent.id` 必须匹配 `^[a-z0-9][a-z0-9._-]{0,63}$`；`agent.bin` 必须匹配 `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`。
- 有 `agent.startup` 时**不得**同时给 `agent.model`；`startup.config` 必须与 `agent.config` 不同。
- `connect` 返回值的顶层键是**键路径**，magpie 按 `.` 切分写入；对象/数组以 JSON 文本传递并转 YAML 块（顺序保留）。
- 模块不得 import 任何包或 Node 内置模块（moejs 里没有 Node）。
- 路径只支持默认 `<home>/.musepi/agent`；`PI_CONFIG_DIR`、命名 profile、Linux XDG 数据根不在 v1 范围，`notice` 与 README 必须写明。
- 许可证 MIT。

## Review Focus

- **模型 id 含点号**（`claude-sonnet-4.5`）：它是数组元素，不是键路径，不能被切分。Task 2 的测试钉住。
- **网关地址带不带 `/v1`**：MusePi 的 `baseUrl` 是 SDK 根地址，请求会自己拼路径。Task 2 测试钉住 `gateway.url` 原样使用。
- **空目录下的 catalog**（`models` 为空）：不能写出空的或非法的 `models` 列表。Task 2 测试钉住。
- **网关 key 总是存在**（实测）：magpie 为每个 agent 生成 `magpie-<agentId>` 形式的键，回环也非空；`connect` 一律写 `apiKey`，不写 `auth: none`。Task 2 测试钉住。
- **`~/.musepi/agent` 不存在**：magpie 的 `SetYAML` 会创建父目录，但必须在真机上确认，而不是假定。Task 4 验证。
- **每模型传输协议**：magpie 的模型条目带 `native_endpoints`（如 `/v1/messages`）。写错 `api` 会让 Claude 类模型丢 thinking 签名。Task 2 按端点选 `api`，测试钉住三种端点。

---

### Task 1: 插件骨架与 agent 描述

**Files:**
- Create: `package.json`
- Create: `musepi.agent.js`
- Create: `test/agent.test.mjs`
- Create: `LICENSE`

**Interfaces:**
- Produces: `musepi.agent.js` 的具名导出 `agent`（`{ id, name, bin, dir, config, format, startup: { config, format, model, keys }, prefix, ua, notice }`）与 `connect({ gateway, models })`（返回 `Record<string, unknown>`）。
- Consumes: 无。

- [ ] **Step 1: 写失败的测试**

`test/agent.test.mjs`：

```js
import assert from "node:assert/strict";
import test from "node:test";
import { agent, connect } from "../musepi.agent.js";

test("agent names MusePi's own files", () => {
  assert.equal(agent.id, "musepi");
  assert.equal(agent.name, "MusePi");
  assert.equal(agent.bin, "musepi");
  assert.equal(agent.dir, "~/.musepi");
  assert.equal(agent.config, "~/.musepi/agent/models.yml");
  assert.equal(agent.format, "yaml");
});

test("the model lives in config.yml, so agent.model stays out", () => {
  assert.equal(agent.model, undefined);
  assert.deepEqual(agent.startup, {
    config: "~/.musepi/agent/config.yml",
    format: "yaml",
    model: "modelRoles.default",
    keys: {},
  });
});

test("magpie's model ids read as magpie/<provider>/<model>", () => {
  assert.equal(agent.prefix, "magpie/");
});

test("magpie's agentplug accepts the id and the command", () => {
  assert.match(agent.id, /^[a-z0-9][a-z0-9._-]{0,63}$/);
  assert.match(agent.bin, /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
});

test("the module exports connect", () => {
  assert.equal(typeof connect, "function");
});

test("the module imports nothing (moejs has no Node)", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../musepi.agent.js", import.meta.url), "utf8");
  assert.equal(/^\s*import\s/m.test(src), false, "musepi.agent.js must not import anything");
});

test("the notice names the folder limit", () => {
  assert.match(agent.notice, /default folder/i);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/agent.test.mjs`
Expected: FAIL — `Cannot find module '../musepi.agent.js'`

- [ ] **Step 3: 写 `musepi.agent.js` 的 `agent` 描述**

文件头部注释说明 MusePi 的两个文件与为什么模型放在 `startup`（照 magpie `internal/agent/omp.go` 的注释体例，但不复制其实现）。导出：

```js
export const agent = {
  id: "musepi",
  name: "MusePi",
  bin: "musepi",
  dir: "~/.musepi",
  config: "~/.musepi/agent/models.yml",
  format: "yaml",
  startup: {
    config: "~/.musepi/agent/config.yml",
    format: "yaml",
    model: "modelRoles.default",
    keys: {},
  },
  prefix: "magpie/",
  ua: ["musepi"],
  notice:
    "MusePi reads models.yml and config.yml when a session starts: start a new session to use the new model.",
};
```

先放一个返回 `{}` 的 `connect` 占位，Task 2 替换。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/agent.test.mjs`
Expected: PASS（7 个测试）

- [ ] **Step 5: 写 `package.json` 与 `LICENSE`**

`package.json` 必须是合法 JSON，含：`name: "magpie-agent-musepi"`、`version: "0.1.0"`、`type: "module"`、`files: ["musepi.agent.js", "README.md"]`、`scripts.test: "node --test \"test/*.test.mjs\""`、`keywords: ["magpie", "magpie-agent", "musepi", "llm-gateway"]`、`license: "MIT"`、`magpie.agent: "./musepi.agent.js"`、`magpie.summary`（en/zh 各一句，中文照抄设计文档）。`LICENSE` 用 MIT 标准全文。

- [ ] **Step 6: 验证清单可被 magpie 读到**

Run: `node -e "const p=require('./package.json'); console.log(p.magpie.agent, p.type, p.name)"`
Expected: `./musepi.agent.js module magpie-agent-musepi`

- [ ] **Step 7: 提交**

```bash
git add package.json musepi.agent.js test/agent.test.mjs LICENSE
git commit -m "feat: add the MusePi agent descriptor"
```

---

### Task 2: connect 写 MusePi 的 provider 条目

**Files:**
- Modify: `musepi.agent.js`
- Create: `test/connect.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `connect` 导出位置。
- Produces: `connect({ gateway: { url, v1, key }, models })` 返回 `{ "providers.magpie": { baseUrl, apiKey, models? } }`。每个模型元素为 `{ id, name, contextWindow?, maxTokens?, cost?, api? }`。

**已实测确认**（magpie 0.1.4295）：`{ "providers.magpie": {...} }` 会写成正确的嵌套 YAML；`gateway.key` 在回环也非空（形如 `magpie-<agentId>`）；`agent.merge` 只对 json 生效，所以**不能**用 merge。

**magpie 传给 `connect` 的模型字段**（已核实，`internal/agent/plugged_connect_facts_test.go`）：`id`、`name`、`context`、`output`、`images`、`efforts`、`pricing`（字符串映射，键 `prompt`/`completion`/`input_cache_read`/`input_cache_write`，USD/token 的十进制字符串）、`native_endpoints`（如 `["/v1/chat/completions"]`）。映射：`context`→`contextWindow`、`output`→`maxTokens`、`pricing`→`cost`（转数字，只取四个键中存在的）。

- [ ] **Step 1: 写失败的测试**

`test/connect.test.mjs`：

```js
import assert from "node:assert/strict";
import test from "node:test";
import { connect } from "../musepi.agent.js";

const gateway = { url: "http://127.0.0.1:3425", v1: "http://127.0.0.1:3425/v1", key: "magpie-musepi" };

test("the provider is one nested key, as magpie writes YAML", () => {
  const out = connect({ gateway, models: [] });
  assert.deepEqual(Object.keys(out), ["providers.magpie"]);
  assert.equal(out["providers.magpie"].baseUrl, "http://127.0.0.1:3425");
});

test("the gateway key is always written, loopback included", () => {
  const out = connect({ gateway, models: [] });
  assert.equal(out["providers.magpie"].apiKey, "magpie-musepi");
  assert.equal(out["providers.magpie"].auth, undefined);
});

test("a model keeps its id, name, window and price", () => {
  const out = connect({
    gateway,
    models: [
      {
        id: "deepseek/deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        context: 128000,
        output: 8192,
        native_endpoints: ["/v1/chat/completions"],
        pricing: { prompt: "0.0000003", completion: "0.0000012", input_cache_read: "0.00000003" },
      },
    ],
  });
  assert.deepEqual(out["providers.magpie"].models, [
    {
      id: "deepseek/deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      contextWindow: 128000,
      maxTokens: 8192,
      api: "openai-completions",
      cost: { input: 0.0000003, output: 0.0000012, cacheRead: 0.00000003, cacheWrite: 0 },
    },
  ]);
});

test("a model id with dots and colons survives whole", () => {
  const out = connect({ gateway, models: [{ id: "anthropic/claude-sonnet-4.5:high", name: "Sonnet 4.5" }] });
  assert.equal(out["providers.magpie"].models[0].id, "anthropic/claude-sonnet-4.5:high");
});

test("an empty catalog writes no models list at all", () => {
  const out = connect({ gateway, models: [] });
  assert.equal(out["providers.magpie"].models, undefined);
});

test("a model without a known window leaves both fields out", () => {
  const out = connect({ gateway, models: [{ id: "x/y" }] });
  assert.deepEqual(out["providers.magpie"].models, [{ id: "x/y", name: "x/y", api: "openai-completions" }]);
});

test("messages and responses endpoints pick MusePi's own api", () => {
  const [messages] = connect({ gateway, models: [{ id: "a/b", native_endpoints: ["/v1/messages"] }] })[
    "providers.magpie"
  ].models;
  assert.equal(messages.api, "anthropic-messages");

  const [responses] = connect({ gateway, models: [{ id: "a/c", native_endpoints: ["/v1/responses"] }] })[
    "providers.magpie"
  ].models;
  assert.equal(responses.api, "openai-responses");
});

test("a catalog ref keeps the nested id MusePi will match against", () => {
  // MusePi splits provider/id at the FIRST slash, so magpie/<a>/<b> must leave
  // the model id as <a>/<b> — the same string written under providers.magpie.models.
  const out = connect({ gateway, models: [{ id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" }] });
  const writtenId = out["providers.magpie"].models[0].id;
  const ref = `${agent.prefix}${writtenId}`;
  const slash = ref.indexOf("/");
  assert.equal(ref.slice(0, slash), "magpie");
  assert.equal(ref.slice(slash + 1), writtenId);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/connect.test.mjs`
Expected: FAIL — `out["providers.magpie"]` 为 `undefined`

- [ ] **Step 3: 实现 `connect`**

返回 `{ "providers.magpie": provider }`。`provider.baseUrl = gateway.url`；`provider.apiKey = gateway.key`（实测回环也非空，不要写 `auth`）；`provider.compat = { promptCacheSessionHeader: "x-session-affinity" }`（网关按这个头把一段会话钉在同一上游；缺了它，负载均衡会让前缀缓存读成接近零的命中率）。模型映射：`name` 缺省用 `id`；`context` → `contextWindow`，`output` → `maxTokens`（有值才写）；`pricing` 转成 `cost: { input, output, cacheRead, cacheWrite }`，缺失键补 0（有 `pricing` 才写）；`api` 从 `native_endpoints` 推导——含 `/v1/messages` → `anthropic-messages`，含 `/v1/responses` → `openai-responses`，否则 `openai-completions`。`models` 为空时整个键不出现。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test "test/*.test.mjs"`
Expected: PASS（15 个测试：agent 描述 7 个 + connect 8 个）

- [ ] **Step 5: 提交**

```bash
git add musepi.agent.js test/connect.test.mjs
git commit -m "feat: write MusePi's magpie provider entry"
```

---

### Task 3: README 与发布元数据

**Files:**
- Create: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: 无。
- Produces: 无（文档与发布元数据）。

- [ ] **Step 1: 写 README**

英文一段 + 中文一段，内容固定为四点：这个插件做什么（MusePi 出现在 magpie Agents 页）；怎么装（`magpie plugin add github:<owner>/magpie-agent-musepi`，或 GUI 的 Plugins 页）；连上之后改哪两个文件（`~/.musepi/agent/models.yml`、`~/.musepi/agent/config.yml`），断开会逐字恢复；已知限制（只支持默认目录；`MUSEPI_PROFILE` 命名 profile 与 `MUSEPI_HOME` 自定义目录尚未支持）。

- [ ] **Step 2: 校验 README 与清单一致**

Run: `node -e "const p=require('./package.json');const fs=require('fs');console.log(p.files.filter(f=>!fs.existsSync(f)))"`
Expected: `[]`

- [ ] **Step 3: 打上 Discover 所需的 topic 说明**

在 README 顶部加一行发布说明：仓库须在 GitHub 打 topic `magpie-plugin`，magpie 才会在 Plugins → Discover → Unofficial 列出它（无审核、按 star 排序）；进入社区精选需另向 `magpie-community/plugins` 提 `registry.json` 条目。

- [ ] **Step 4: 提交**

```bash
git add README.md package.json
git commit -m "docs: describe installing MusePi as a magpie agent"
```

---

### Task 4: 真机端到端验证

**Files:**
- Create: `VERIFICATION.md`（记录本次结果与日期，不写进 `files`）

**Interfaces:**
- Consumes: Task 1–3 的全部产物。
- Produces: 一份可复现的验收记录。

- [ ] **Step 1: 沙箱连接**

**Windows 上必须设 `USERPROFILE`，不是 `HOME`**：`appdir.Home()` 在 Windows 读 `USERPROFILE`（`internal/appdir/env.go:17-22`）；用 `HOME` 会写进真实用户目录。

```bash
export USERPROFILE="C:\\...\\sandbox\\home"   # 绝对路径，指向一个空目录
mkdir -p "$USERPROFILE/.musepi/agent"
magpie plugin add <仓库绝对路径>
magpie agents | grep -i musepi
```

Expected: `magpie agents` 出现该行；`magpie plugin` 列出它且为 on。

- [ ] **Step 2: 检查写入的两个文件**

```bash
magpie musepi model "magpie/<provider>/<model>"   # 触发 connect
cat "$USERPROFILE/.musepi/agent/models.yml"
cat "$USERPROFILE/.musepi/agent/config.yml"
```

Expected：`models.yml` 为

```yaml
providers:
  magpie:
    # magpie: points at magpie's local gateway; …
    baseUrl: http://127.0.0.1:3425
    apiKey: magpie-musepi
    models:
      - id: <provider>/<model>
        name: …
```

`config.yml` 为 `modelRoles: { default: magpie/<provider>/<model> }`。（实测形态，`# magpie:` 注释行由 magpie 自动加。）

- [ ] **Step 3: 真实请求**

用沙箱 `MUSEPI_HOME` 启动 MusePi，发一轮对话。
Expected: 请求到达 magpie；Usage 页把该请求记在 MusePi 名下。若某类模型（尤其 Claude）报传输或签名错误，记录实际错误与 `native_endpoints` 的取值，修正 Task 2 的端点映射后重跑本步。

- [ ] **Step 4: 断开还原**

```bash
magpie musepi model ""    # 断开
cat "$USERPROFILE/.musepi/agent/models.yml"
cat "$USERPROFILE/.musepi/agent/config.yml"
```

Expected：用户原有的键还原；magpie 造的空容器**会保留**为 `providers: {}` / `modelRoles: {}`（实测行为，不是逐字删除文件）。若连接前这两个文件不存在，断开后它们存在但内容为空壳——这是 magpie 的既有语义，记录即可，不要当作缺陷。

- [ ] **Step 5: 从 GitHub 安装复验**

`magpie plugin add github:<owner>/magpie-agent-musepi`，重复 Step 1–4。
Expected: 与本地路径安装结果一致。

- [ ] **Step 6: 记录并提交**

`VERIFICATION.md` 写入日期、magpie 与 MusePi 版本、每步结果、端点映射是否修正。

```bash
git add VERIFICATION.md
git commit -m "test: record the end-to-end run"
```
