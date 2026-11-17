# Verification — 2026-11-17

magpie 0.1.4295 (Windows), MusePi working tree at `D4350ebc7`.

## Setup

Isolated `USERPROFILE=C:\Users\universe\AppData\Local\Temp\mv1\home` with no
`.musepi` present. magpie's own config copied in, plugins list emptied.

> Windows only: `appdir.Home()` reads `USERPROFILE`, not `HOME`
> (`internal/appdir/env.go:17-22`). A sandbox must set `USERPROFILE`.

## Steps and results

| Step | Result |
|---|---|
| `magpie plugin add D:\Projects\Agents\magpie-agent-musepi` | plugin listed, on |
| `magpie agents` | `MusePi  not detected` — see finding 1 |
| `magpie musepi model magpie/copilot/auto` | `✓ MusePi model magpie/copilot/auto` |
| `models.yml` written | `providers.magpie` with `baseUrl`, `apiKey`, `models[]` |
| `config.yml` written | `modelRoles: { default: magpie/copilot/auto }` |
| `.musepi/agent` auto-created | yes (the folder did not exist) |
| MusePi `getModelsConfigSchema()` | **VALID** |
| `modelRoles.default` → written id | **match** (`magpie/copilot/auto` → `copilot/auto`) |
| `magpie musepi model ""` (disconnect) | `providers: {}` / `modelRoles: {}` |
| unit tests `node --test` | 15 pass, 0 fail |

Written shape:

```yaml
providers:
  magpie:
    # magpie: points at magpie's local gateway; …
    baseUrl: http://127.0.0.1:3425
    apiKey: magpie-musepi
    models:
      - id: copilot/auto
        name: auto · Copilot
        api: anthropic-messages
```

## Findings

1. **`bin: "musepi"` is not on PATH here**, so magpie shows the agent as
   `not detected`. The row still works: connecting writes both files. On a
   machine where MusePi is installed as a command (`musepi` on PATH, or
   `~/.musepi` present) the row reads as detected. This is the design's open
   question 6, answered: detection is cosmetic for wiring, not a gate.

2. **`api` follows the model's native endpoints.** `copilot/auto` relays on
   Anthropic Messages, so the written entry says `api: anthropic-messages`
   rather than the Chat default. The mapping runs per model, as designed.

3. **The catalog is whatever magpie has.** The sandbox had one model
   (`copilot/auto`) and one was written. Nothing is dropped or invented.

4. **Disconnect leaves empty tables**, not deletions: `providers: {}` and
   `modelRoles: {}`. Matches the design's finding 5; magpie's own behaviour
   for every agent.

## Not verified here

- A real MusePi session reading `modelRoles.default` and sending a turn
  through the gateway: needs a MusePi run, which this sandbox does not have.
- Thinking-signature preservation on a Claude model end to end: same reason.
