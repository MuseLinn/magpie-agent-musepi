# magpie agent 插件：MusePi 接入

## Intent

magpie（yetone/magpie）把每个 agent 的模型配置统一到一个本地网关后面：Agents 页列出所有已安装的 agent，选中一个模型即改写该 agent 自己的配置，反向代理、订阅复用、配额、路由组、用量统计都由 magpie 负责。它已经内置 100+ agent 适配（含 Pi、oh-my-pi/omp、Kimi Code），但**没有 MusePi**。

目标：让 MusePi 出现在 magpie 的 Agents 页，一键连到 magpie 网关、在 magpie 的模型选择器里挑模型、关掉即恢复原配置 —— 与其它 agent 完全一致的用户体验。

## 为什么是 magpie 侧插件，而不是 MusePi 侧扩展

两条路都能"让两者协同"，但解决的问题不同：

| | A. MusePi 扩展（`pi.registerProvider`） | B. magpie agent 插件（本设计） |
|---|---|---|
| 用户在哪操作 | MusePi 设置页 | magpie Agents 页（与所有 agent 一致） |
| 模型目录 | MusePi 自己拉 `/models` | magpie 的完整目录：provider、路由组、免费/订阅模型、价格 |
| 配额 / 路由 / 故障转移 / 用量 | 不覆盖 | magpie 原生覆盖 |
| 依赖上游 | 无（MusePi 有稳定缝） | 无（magpie 有稳定的 agent 插件缝） |
| 需要改 Go | 否 | 否 |

B 的"注册 provider"动作本身就会写 `models.yml` 的 `providers.magpie`，A 的主交付物是它的子集。因此 v1 只做 B；A 的意义只剩 MusePi 内的状态页与 magpie MCP 工具挂载，列为后续（见 Non-goals）。

## 机制（magpie 侧，已核实）

`internal/agentplug` 让插件声明一个 agent：

- 包 `package.json` 的 `magpie.agent` 指向一个 `*.agent.js`，magpie 用内置 JS 运行时（moejs）加载，模块**不得 import 任何包或 Node 内置模块**；
- 模块导出 `agent` 描述对象与 `connect({ gateway, models })`；
- `agent.config` 是 magpie 写 provider 的文件，`connect` 返回的**顶层键就是键路径**；
- `agent.startup` 用于"新会话默认模型在另一个文件"的 agent；`startup.model` 同样是键路径，`startup.keys` 是同时写入的常量；
- 每个被写入的文件都有 stash，断开时把用户原有的键放回；magpie 只删自己写的东西。

写入语义（`internal/edit/yaml.go:121` `SetYAML`、`internal/agent/plugged.go:431/537`）：

- 路径按 `.` 切分嵌套写入，缺失父级自动创建；
- 值可以是 `json.RawMessage`：连接返回的对象/数组以 JSON 文本传入，转成 YAML 块并**保留键序**；
- 因此 `"providers.magpie.models": [...]` 会写成正确的嵌套结构；但点号是分隔符，模型 id 只能出现在**数组元素内**（安全），不能做键路径。

`agentplug` 校验（`agentplug.go:432` `Desc.check`）：`agent.id` 匹配 `^[a-z0-9][a-z0-9._-]{0,63}$`，`bin` 匹配 `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`，有 `startup` 时不得再给 `model`，且 `startup.config` 必须与 `config` 不同。

`connect` 拿到的模型字段（`internal/agent/plugged_connect_facts_test.go:45-51`）：`id`、`name`、`context`、`output`、`images`、`efforts`、`pricing`（字符串映射，键 `prompt`/`completion`/`input_cache_read`/`input_cache_write`，USD/token）、`native_endpoints`（如 `["/v1/chat/completions"]`）。MusePi 的 `cost` 单位是 **USD/百万 token**（`packages/catalog/src/models.ts:97` `calculateCost` 除以 1e6），所以 `pricing` 转 `cost` 必须 ×1e6。

## MusePi 的配置落点（已核实）

### 路径解析链

MusePi 的 agent 目录不是固定的 `~/.musepi/agent`，按优先级：

1. **`PI_CONFIG_DIR`**（`packages/utils/src/dirs.ts:235`）——若为绝对路径，**整体替换** `~/.musepi`（GUI 的数据根迁移就是这么用的）；否则是 home 下的目录名。
2. **`MUSEPI_HOME` / `MUSEPI_PROFILE`**（`dirs.ts:128`）——命名 profile 时，agent 目录为 `<configRoot>/profiles/<name>/agent`（`dirs.ts:140`、`115-118`）。名字须匹配 `^[a-z0-9][a-z0-9._-]{0,63}$`（`dirs.ts:38`）。
3. **`PI_CODING_AGENT_DIR`**（`dirs.ts:136,387-391`）——仅在默认 profile 下生效，且若它恰好等于 profile 派生路径则忽略。

默认：`<home>/.musepi/agent`（`dirs.ts:24` `CONFIG_DIR_NAME = ".musepi"`）。

**Linux XDG 分叉**（`dirs.ts:279-329`）：默认 profile 在 Linux 上、且用户做过 `musepi config init-xdg` 迁移时，agent 目录可能落到 `$XDG_DATA_HOME/musepi` 之类的路径。**但 `models.yml` 走 `configRoot` 而不是 XDG**：`model-registry.ts:282` 是 `path.join(getAgentDir(), "models.yml")` —— 而 `getAgentDir()` 返回 `dirs.agentDir`（`dirs.ts:558`），在 XDG 下会变。所以两个文件可能不在同一目录，插件必须分别定位而不能假定同源。

### 文件

- **`<agentDir>/models.yml`** —— `providers.<id>` 支持 `baseUrl`、`apiKey`、`api`、`headers`、`compat`、`auth`（`"apiKey" | "none" | "oauth"`）、`models[]`、`modelOverrides`、`disableStrictTools`、`discovery`、`transport`（`config/models-config-schema-bundle.ts:281-301`）。`auth: "none"` 是回环无密钥的路，但实测 magpie 总会给键，所以插件用 `apiKey`。
- **`<agentDir>/config.yml`** —— `MAIN_CONFIG_FILENAMES = ["config.yml", "config.yaml"]`（`dirs.ts:27`），写入目标是 `config.yml`，读取时 `config.yaml` 作为回退；`modelRoles` 是 `role → "provider/model"` 记录（`settings-schema.ts:756`、`settings.ts:1078` `getModelRole`）。
- 两者都经 `ConfigFile.relocate()` 处理，会在 `models.yml` 不存在而 `models.json` 存在时做一次 JSON→YAML 迁移（`config-file.ts:178-195`）。插件只写 `.yml`，迁移由 MusePi 自己做。
- **模型身份是 `provider/id`**，所以 magpie 的模型在 MusePi 侧显示为 `magpie/<provider>/<model>`。

### 插件侧的路径应对

`agent.config` / `agent.startup.config` 在 `Desc.check` 里是静态字符串，只能写一个路径。但 magpie 的 `pluggedPathEnv`（`internal/agent/plugged.go:136-147`）在展开路径时**会按 shell 语义展开 `$VAR` 与 `~`**（`HOME` 特殊处理为 magpie 读到的 home）。

这意味着路径可以写成一个变量表达式：

```js
config: "$MUSEPI_AGENT_DIR/models.yml",
```

若桌面壳/终端启动 magpie 时 `MUSEPI_AGENT_DIR` 存在，magpie 就写在用户真实用的目录；不存在时 `$MUSEPI_AGENT_DIR` 展开为空串，路径变成 `/models.yml` —— **不可接受**。取值不可靠，因此 v1 采用默认路径，并明确记录限制。

结论：v1 只支持默认路径 `~/.musepi/agent`。若 `PI_CONFIG_DIR` / 命名 profile / XDG 生效，magpie 会写到默认位置而 MusePi 读别处，表现为"连上了但模型没出现"。这**不会损坏用户数据**（不会写到用户不读的文件里造成破坏），但必须**在 README 与 agent 的 `notice` 里明说**。

v1.1 的可行做法（择一，实施时验证）：

- **首选**：magpie 的 `agent.config` 支持 `$VAR`，让插件把路径写成 `$MUSEPI_HOME/...` 的形式前，先由 magpie 侧为 MusePi 提供"路径可配置"能力（类似内置 omp 适配器的 `ompDir` 枚举 `PI_CONFIG_DIR` / 命名 profile / `PI_CODING_AGENT_DIR`）。这需要给 magpie 提 issue 或改用带 `main` 的 Bun 形态。
- **备选**：改用带 `main` 的 agent 形态（`magpie-agent-deva` 那种）：`agent.config` 指向 magpie 自己的中间文件，`main` 是 Bun 模块，运行时探测 MusePi 的真实目录并把配置 merge 进去。代价是多一个运行时依赖与 10 倍于纯描述的实现。

### Library 集成（v1.1，形状已核实但 v1 不启用）

magpie 的 agent 描述可选 `library` 块，声明 agent 从哪里读 magpie 资源库给的 instructions / MCP / skills（`agentplug.go:44-52`、`220-227`）。MusePi 的三处落点都可对应：

| magpie 字段 | MusePi 的读取位置 | 形状 |
|---|---|---|
| `library.mcp` + `mcpFormat` | `<agentDir>/mcp.json` 或 `<agentDir>/.mcp.json`（`discovery/builtin.ts:222-223`） | `mcpFormat: "claude"` = `{ mcpServers: { name: {...} } }`，与 MusePi 的解析一致（`builtin.ts:121-122`） |
| `library.skills` | `<agentDir>/skills/<name>/SKILL.md`（`scanSkillsFromDir`） | magpie 写目录，MusePi 扫描 |
| `library.instructions` | MusePi 的指令文件走 `AGENTS.md` 发现链；`<agentDir>/AGENTS.md` 是否被读取需在实施时确认 | 待确认 |

v1 不启用：三者都需要在真机上先确认 MusePi 确实读这些路径（尤其 `instructions`），否则 magpie 会写进一个没人读的文件。启用时只加 `library` 块，不改 `connect`。

### v1 实测结论（本机 magpie 0.1.4295，Windows）

在隔离 `USERPROFILE` 沙箱里装了一个探针插件并走完整连接/断开，四处关键结论：

1. **嵌套写入正确**（实证）：`connect` 返回 `{ "providers.magpie": {...} }` 写出

```yaml
providers:
  magpie:
    # magpie: points at magpie's local gateway; …
    baseUrl: http://127.0.0.1:3425
    apiKey: magpie-musesbx2
    models:
      - id: copilot/auto
        name: auto · Copilot
```

magpie 会在这段上面自动加一行 `# magpie: …` 注释，断开时随条目一起移除。

2. **`startup.model: "modelRoles.default"` 正确**（实证）：写出

```yaml
modelRoles:
  default: magpie/copilot/auto
```

3. **`agent.merge` 只对 json 生效**（实证报错 `agent.merge is for a json agent.config`）。所以不能靠 merge 把 `providers.magpie` 成员逐个并入——之前设计里"merge 位"的方案对 MusePi（YAML）**不可用**，只能用点号键整体写入。

4. **`gateway.key` 在回环也有值**（实证）：magpie 为每个 agent 生成 `<gateway-key>-<agentId>` 形式的键，即使回环也非空。因此 `connect` **永远应写 `apiKey: gateway.key`**，不能写 `auth: "none"`——`auth: none` 只在 magpie 无法给键时才需要。实测 `apiKey: magpie-musesbx2`（键名由 magpie 生成，插件只需原样回填）。

5. **断开不还原成空白，而是保留空壳**（实证）：断开后 `models.yml` 是 `providers: {}`、`config.yml` 是 `modelRoles: {}`，而不是删掉文件。这是 magpie 的 `emptyObject` 清理行为——空表被保留。**这修正了原设计里"逐字还原"的表述**：还原的是用户原有的键，magpie 自己造的空容器会留下。

6. **MusePi 接受写出的结构**（实证）：用 MusePi 自己的 `getModelsConfigSchema()` 校验写出的 `providers.magpie`（含 `baseUrl`/`apiKey`/`models[]`/`api`/`cost`），结果 VALID。

7. **模型引用能精确匹配**（实证）：`modelRoles.default = magpie/deepseek/deepseek-v4-pro` 经 `parseModelString` 解析为 provider=`magpie`、id=`deepseek/deepseek-v4-pro`，与写入的 model id 完全一致。原因是 MusePi 按**第一个 `/`** 切分 provider——正好与 `magpie/<catalogRef>` 的形状吻合。

8. **目录与文件会自动创建**（实证）：在一个完全没有 `.musepi` 的沙箱里连接，magpie 创建了 `<home>/.musepi/agent/` 并写出两个文件。

**已知约束（实测无实际影响）：** MusePi 会把模型引用的 `:<level>` 后缀当作 thinking level 切掉（`model-ref.ts` 的 `splitThinkingSuffix`）。若某个模型 id 自身以 `:high` 这类合法 level 结尾，就会被误解析。实测本机 magpie 目录的 101 个模型无此形态，故 v1 不处理；若将来出现，需在 `connect` 里把该 id 重写或标记。

## 设计

### 包结构

独立仓库（不放进 MusePi 的 packages）：`D:/Projects/Agents/magpie-agent-musepi`。

```
magpie-agent-musepi/
  package.json      # name, magpie.agent, magpie.icon, magpie.summary, keywords
  musepi.agent.js   # 唯一实现
  test/agent.test.mjs
  test/connect.test.mjs
  README.md
  LICENSE
```

`package.json` 关键字段：

```json
{
  "name": "magpie-agent-musepi",
  "version": "0.1.0",
  "keywords": ["magpie", "magpie-agent", "musepi", "llm-gateway"],
  "type": "module",
  "files": ["musepi.agent.js", "README.md"],
  "scripts": { "test": "node --test \"test/*.test.mjs\"" },
  "magpie": {
    "agent": "./musepi.agent.js",
    "summary": {
      "en": "MusePi on magpie's Agents page: pick one of magpie's models for it, and switch it off to put its config back.",
      "zh": "把 MusePi 加到 magpie 的 Agent 页：给它选 magpie 的模型，关掉即恢复原来的配置。"
    }
  }
}
```

### agent 描述

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
    "Reopen MusePi's model menu, or start a new session, to use the new model.",
};
```

- `bin` / `dir` 供 magpie 判断"装了没有"（`musepi` 在 PATH，或 `~/.musepi` 存在）。
- 不给顶层 `model`：模型在 `startup` 指的文件里，`connect` 只写 provider 表。
- `prefix: "magpie/"` 让选中模型的写入值为 `magpie/<provider>/<model>`。
- `ua` 让 magpie 的 Usage 页把请求认作 MusePi（MusePi 的 User-Agent 为 `musepi/<version>`，`dirs.ts:33`）。

### connect

```js
export function connect({ gateway, models }) {
  const list = (models ?? []).map(m => {
    const entry = { id: m.id, name: m.name ?? m.id, api: apiFor(m.native_endpoints) };
    if (m.context) entry.contextWindow = m.context;
    if (m.output) entry.maxTokens = m.output;
    if (entry.api === "openai-responses") entry.baseUrl = gateway.v1; // /responses 只在网关的 /v1 上
    if (m.images === true) entry.input = ["text", "image"];
    const thinking = thinkingFor(entry.api, m.efforts);
    if (thinking) { entry.reasoning = true; entry.thinking = thinking; }
    else if (m.efforts?.length) entry.reasoning = true; // Anthropic：mode 交给 MusePi 按 id 选
    if (m.pricing) entry.cost = toCost(m.pricing);      // USD/token → USD/百万 token
    return entry;
  });
  return { "providers.magpie": { baseUrl: gateway.url, apiKey: gateway.key, ...(list.length ? { models: list } : {}) } };
}
```

`toCost` 把 `pricing` 的字符串转数字、乘以 1e6 写成 MusePi 的 USD/百万 token，缺失的四个键补 0：`{ input, output, cacheRead, cacheWrite }`。不换算会让每次调用少报一百万倍（MusePi 用 `cost.input / 1e6 * tokens` 计价）。

`models` 为空时仍写 `baseUrl` 与 `apiKey`，不写空的 `models` 数组（空数组会让 MusePi 的 provider 没有任何模型，且掩盖真实故障）。

`api` 按 `native_endpoints` 逐模型选择：Claude 类模型走 `anthropic-messages` 才保住 thinking 签名；Responses 类走 `openai-responses`；其余 `openai-completions`。Responses 是唯一需要逐模型 `baseUrl: gateway.v1` 的协议：MusePi 把 `/responses` 拼在 base URL 后，而 magpie 只在 `/v1/responses` 上服务；Chat 有 `/chat/completions` 根别名，Messages 由 MusePi 补 `/v1/messages`，两者都用根地址。

`images` 为 true 时写 `input: ["text", "image"]`；为 false 时不写，让 MusePi 按模型 id 推断（magpie 的布尔只表示"已知能看图"，false 不代表不能）。**视频输入写不出来**：magpie 的 `catalog.Model.InputModalities` 里可能有 `video`（`zcodeInputs` 就是这么用的），但 `connect` 的模型事实只带 `images`；models.yml 的 `input` 一旦显式写出就覆盖 MusePi 的 id 推断，所以带视频的 id 只能等上游把 `input_modalities` 加进事实后再写全。

`efforts` 是 magpie 的能力阶梯（`minimal`…`max`）。非 Anthropic 协议直接写成 `thinking: { mode: "effort", efforts }`（按 MusePi 的顺序过滤、去重）；Anthropic 只写 `reasoning: true`，因为 MusePi 会按模型 id 在 `anthropic-adaptive` / `anthropic-budget-effort` / `budget` 之间选择，插件钉死 mode 会覆盖这份更细的规则。任何未知 effort 都被丢弃：models.yml 是整文件校验，一个非法值会让 MusePi 停用全部自定义供应商。

### own

`own({ config, model })` 是 magpie 行内模型选择器要的"MusePi 自己的模型"：读 `models.yml`（`config` 就是解析后的它），把 `magpie` 之外的 provider 下的每个模型写成 `{ value: "<provider>/<id>", model: <id>, direct: <provider 的 label，否则 id> }`，按 value 排序。`direct` 让 magpie 标成"不经过 magpie、直连该 provider"；选中后 magpie 把值写进 `config.yml` 的 `modelRoles.default`（不带 `magpie/` 前缀），MusePi 用自己的 key 请求那个 provider。

两个边界来自契约本身：

- 插件只拿到 `models.yml`，看不到 MusePi 的 bundled 目录，所以登录态的内置 provider（Anthropic、Copilot…）不在列表里；MusePi 当前所选的模型若不在文件里，会被放在最前面当当前值（`pluggedOwn` 已把 `magpie/` 开头的当前值清空）。
- `models.yml` 的 provider 没有 `label` 时用 id 当 vendor 名。`label` 是插件文档之外的 MusePi 字段（`providers.<id>.label`，只影响显示），magpie 写 provider 块时可以顺带写。

MusePi 的完整可用清单不在插件契约里：`own` 只拿到 `config`（models.yml）与 `base`，而 `base` 只对 `launch` 型插件开放（`agentplug.Desc.check`），插件运行时也没有子进程/文件访问。MusePi 提供的机器可读接口是 `musepi models ls --json`（可用模型、`providerLabel`、能力与价格），magpie 的内置适配器可以运行命令/读文件（omp、OpenCode、dsh、Kimi Code 都是这么做的），但通用 JS 插件不行。要让 magpie 行里出现登录态的内置 provider，需要 magpie 侧新增内置适配器或把清单纳入插件契约，不是本插件单侧能解决的。

### 发布与"怎么让 magpie 搜到"

三层，从轻到重：

1. **Discover → Unofficial（v1 目标）**：GitHub 仓库打 topic `magpie-plugin`。magpie 每 10 分钟搜一次 `topic:magpie-plugin archived:false fork:false`（`internal/plugin/github.go:253`）；社区仓的 workflow 每半小时把结果构建成 `tagged.json` 经 usemagpie.ai 下发，卡片读 `package.json` 的 `magpie.icon` / `magpie.name` / `magpie.summary`。打上 topic 后 1 小时内出现，**无审核**，卡片会标注"作者自述、未经审核"。
2. **社区精选（可选，后做）**：向 `magpie-community/plugins` 提 `registry.json` 条目（`{ package, name, kind: "agent", community: true, summary }`）。进入后支持短名安装、被建议为 agent。
3. **直接安装（始终可用）**：`magpie plugin add github:<owner>/<repo>`，或 npm 包名，或本地路径。

npm 发布可选：不发布也能走 `github:owner/repo`。

### 安装后的行为

连接时 magpie 写（以下为实测产出形态）：

```yaml
# ~/.musepi/agent/models.yml
providers:
  magpie:
    # magpie: points at magpie's local gateway; Disconnect in magpie or `magpie uninstall` undoes it, …
    baseUrl: http://127.0.0.1:3425
    apiKey: magpie-musepi
    models:
      - id: deepseek/deepseek-v4-pro
        name: DeepSeek V4 Pro
        contextWindow: 128000
        maxTokens: 8192
        api: openai-completions
```

```yaml
# ~/.musepi/agent/config.yml
modelRoles:
  default: magpie/deepseek/deepseek-v4-pro
```

断开时用户原有的键还原（magpie 的 stash）；magpie 自己造的空容器保留为空表（实测）。

## Goals

- magpie Agents 页出现 MusePi 一行，能连、能选模型、能断。
- 连接后新开 MusePi 会话即走 magpie 网关，模型是所选那个。
- 断开后用户原有的 `models.yml` / `config.yml` 内容还原；magpie 造的空表可留。
- `magpie plugin add <path>` 与 `github:owner/repo` 两种安装都成功。
- `node --test` 覆盖 `agent` 描述与 `connect` 的全部契约分支。

## Non-goals（v1）

- MusePi 侧扩展（`registerProvider` 状态页、magpie MCP 工具挂载）。
- Library 集成（`library.mcp` / `skills` / `instructions`）：形状已核实，但要先在真机确认 MusePi 读这些路径；见「Library 集成」节。
- 命名 profile（`MUSEPI_PROFILE`）、`PI_CONFIG_DIR`、Linux XDG 数据根的多目录支持（见"插件侧的路径应对"）。
- 思考等级（`effort`）的 per-row 选择。
- WSL 双胞胎（`wsl: true`）。
- magpie UI/UX 的移植（单独立项）。

## Risks / 已核实与待验证

**已实测确认（magpie 0.1.4295，隔离 USERPROFILE）:**

1. 嵌套写入可行，实测产出正确 YAML（见「v1 实测结论」1）。
2. `startup.model: "modelRoles.default"` 写出 `modelRoles: { default: magpie/<ref> }`（实测 2）。
3. `gateway.key` 在回环也非空，`apiKey` 必须写（实测 4）；`auth: none` 不是 v1 的路径。
4. `agent.merge` 只对 json 生效（实测 3），所以只能点号键整体写入。
5. 断开留下 `providers: {}` / `modelRoles: {}` 空壳，不是逐字删除（实测 5）。

**仍需验证（需 MusePi 实际运行）：**

6. **`bin: "musepi"` 的探测**：若 MusePi 通过 bun/npm 安装则 `musepi` 在 PATH；若只在仓库里 `bun run`，magpie 不显示该行。`dir: "~/.musepi"` 是第二信号。
7. **`api` 与实际传输**：按 `native_endpoints` 写 `api` 是推导；需真机确认 Claude 类模型 thinking 签名保住，否则退回统一 `openai-completions`。
8. **`modelRoles.default` 被 MusePi 读到**：写入已证实，但 MusePi 新会话是否真换模型要跑一次会话。

## 验证

沙箱必须设 **`USERPROFILE`** 而不是 `HOME`：`appdir.Home()` 在 Windows 读 `USERPROFILE`（`internal/appdir/env.go:17-22`）。用 `HOME` 会写进真实用户目录——本设计过程踩过这个坑。

1. 隔离 `USERPROFILE` 下建空的 `<home>/.musepi/agent`，`magpie plugin add <repo 路径>`；`magpie agents` 出现该行。
2. `magpie <id> model magpie/<provider>/<model>` 触发 connect，检查两个文件的写入。
3. `MUSEPI_HOME=<沙箱>` 启动 MusePi 发一轮对话：请求到达 magpie，Usage 页记为 MusePi。
4. 断开（`magpie <id> model ""`），确认用户原有键还原；magpie 造的空容器会保留。
5. `magpie plugin add github:<owner>/repo` 重复 2–4。

## 假设

- 仓库名 `magpie-agent-musepi`，npm 同名（未占用时；占用则加个人 scope）。
- 许可证 MIT（与 magpie 生态一致）。
- v1 只支持默认目录；多目录支持留待 magpie 提供动态 `config` 或改用带 `main` 的形态。
