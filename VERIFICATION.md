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
