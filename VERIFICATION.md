# Verification — 2026-11-17

magpie 0.1.4295 (Windows), MusePi 0.7.6 (repo HEAD `4350ebc7`).

## Unit tests

`node --test "test/*.test.mjs"` — 15 pass, 0 fail.

## Sandbox run (fresh `USERPROFILE`, no `.musepi`)

> Windows only: `appdir.Home()` reads `USERPROFILE`, not `HOME`
> (`internal/appdir/env.go:17-22`). A sandbox must set `USERPROFILE`, or the
> plugin lands in the real magpie config.

| Step | Result |
|---|---|
| `magpie plugin add <repo>` | listed, on |
| `magpie agents` | `MusePi  not detected` (no `musepi` on PATH) |
| `magpie musepi model magpie/copilot/auto` | written |
| `.musepi/agent` auto-created | yes |
| `models.yml` / `config.yml` | correct shapes |
| MusePi `getModelsConfigSchema()` | VALID |
| `modelRoles.default` → written id | match |
| disconnect | `providers: {}` / `modelRoles: {}` |

## Real run (MusePi session through magpie)

`magpie musepi model magpie/codex/gpt-6-luna`, then
`bun --cwd=packages/coding-agent src/cli.ts -p "输出你的模型全名"`.

The model answered **`magpie/codex/gpt-6-luna`**. magpie's usage log:

```
model=gpt-6-luna  ep=/responses  status=200  in=51478  out=214  reasoning=197
```

That confirms three things at once:

- **`modelRoles.default` is read**: MusePi resolved the ref and started on it.
- **`api` maps correctly**: the turn went to `/responses`, matching the
  `api: openai-responses` written for that model.
- **Thinking survives**: `reasoning=197` — the reasoning payload crossed the
  gateway intact.

## Defect found: disconnecting deletes the user's `default` role

Reproduced on the real machine. Before connecting, `~/.musepi/agent/config.yml`
had:

```yaml
modelRoles:
  default: agnes/agnes-3.0-flash
  smol: …
  slow: …
```

After connect → disconnect, `default` was **gone**; the other roles were
untouched.

Cause: `agent.connect()` stashes `a.Values()` under `<id>.connect.was`
(`internal/agent/applied.go:753-755`). For a plugin agent with `startup` and
no `model`, `Values()` has no model entry, so the stash records only
`{"model": "agnes/agnes-3.0-flash"}` — a key that never existed. The startup
file's own stash (`plugin:musepi:<path>`) is written, but
`connect.was`'s restore path then removes the model role.

Workaround recorded in `README.md`? No — this needs a magpie fix or a
different plugin shape (`model` instead of `startup`, which cannot express
MusePi's split files).

Until fixed: back up `modelRoles.default` before connecting, or restore it by
hand after disconnecting.

## Not verified

- Thinking signatures across a multi-turn tool-calling session (one turn was
  enough to prove reasoning crosses the gateway; tool-turn signature reuse
  was not exercised).

## Verification — 2026-11-18 (model facts MusePi can use)

MusePi's model entry takes four facts the plugin had not written, and one it
wrote in the wrong unit. Verified against MusePi's own schema and registry on
this machine, not by reading code alone:

| Check | Result |
|---|---|
| `node --test "test/*.test.mjs"` | 31 pass, 0 fail |
| `getModelsConfigSchema().assert()` on the written `providers.magpie` | VALID |
| `own()` over a `models.yml` with one labeled provider | `provider/id` picks, `direct` = the label, the `magpie` provider left out |
| `modelRoles.default` set to one of those picks | resolves through MusePi's `resolveModelRoleValue` to `provider/id` |
| `providers.<id>.label` read back | `getProviderLabel` returns it, `find()` still keys on the id |
| `ModelRegistry` over the written file: `pricing.prompt: "0.00000015"` | `cost.input: 0.15` (USD per million) |
| A model with `images: true` | `input: ["text", "image"]` |
| A model with `native_endpoints: ["/v1/responses"]` | `api: openai-responses`, `baseUrl: <gateway>/v1` |
| A Chat model with `efforts: ["low", "medium", "high"]` | `reasoning: true`, `thinking: { mode: "effort", efforts: [...] }` |
| An Anthropic model with the same efforts | `reasoning: true`, no pinned `thinking.mode` (MusePi keeps its id-based adaptive/budget choice) |

The cost unit was the defect: magpie hands out USD a token (OpenRouter's
shape), MusePi prices a million (`calculateCost` divides by 1e6). Writing one
as the other made every magpie call cost 1e-6 of its real price in MusePi's
usage view. `toCost` now scales and drops float noise (`1.5e-7` → `0.15`).

Responses was the second: MusePi appends `/responses` to the model's base URL
and magpie serves it at `/v1/responses` only. Chat survives on magpie's
`/chat/completions` root alias and Messages on MusePi's own `/v1/messages`
tail, so only Responses needs the `/v1` base.

Not written, and why:

- **Video input.** magpie's `catalog.Model.InputModalities` can say `video`
  (`zcodeInputs` reads it), but the plugin facts carry only `images`.
  Models.yml's `input`, once written, overrides MusePi's id-based inference, so
  a video model keeps that inference until upstream exposes
  `input_modalities`.
- **Image generation.** `connect` lists chat models only; image models are
  `gateway.ImageModels()`, and MusePi's `models.yml` has no image API.

## Verification — 2026-11-19 (the agent's own icon was dropped)

`musepi.agent.js` carried the picture as
`data:image/png;base64,data:image/png;base64,iVBOR…` — the URI prefix written
twice, already published in 0.1.2. magpie's `pluginOwnIcon`
(`internal/provider/plugin_icon.go:127-134`) hands everything after `data:`
to `dataURI`, which decodes the payload with strict base64; the second
`data:image/png;base64,` is not base64, so `StoreIcon` never sees a picture
and the agent's icon is dropped. The row still showed one because magpie
then falls back to `package.json`'s `magpie.icon`, whose prefix is single.

The test only matched the prefix and the length, so it passed either way. It
now decodes the payload and checks the PNG signature, which fails on a
repeated prefix.
