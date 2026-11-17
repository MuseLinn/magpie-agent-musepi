# magpie-agent-musepi

MusePi ([musepi](https://github.com/)) as an agent on magpie's Agents page:
pick one of magpie's models for it, and switch it off to put its config back.

把 MusePi 加到 magpie 的 Agents 页：给它选 magpie 的模型，关掉即恢复原来的配置。

## Install

```sh
magpie plugin add github:<owner>/magpie-agent-musepi
```

Then connect MusePi on magpie's Agents page and pick a model. A new MusePi
session uses it.

Over the window: Settings → Plugins → add the same address.

## What it writes

magpie edits two files under MusePi's default agent folder:

- `~/.musepi/agent/models.yml` — its provider `magpie` (the gateway's
  address, the key magpie keeps for MusePi, and magpie's catalog as that
  provider's models);
- `~/.musepi/agent/config.yml` — `modelRoles.default`, the model a new
  session starts on, as `magpie/<provider>/<model>`.

Disconnect puts back what those files had. An empty table magpie made
(`providers: {}`, `modelRoles: {}`) stays, as magpie leaves it for every
agent.

## Limits

- **Only the default folder is wired.** A named profile (`MUSEPI_HOME`,
  `MUSEPI_PROFILE`), `PI_CONFIG_DIR`, or a Linux XDG data root moves
  MusePi's files; magpie's `agent.config` is one fixed path, so it would
  write where MusePi does not look. Start MusePi on its default folder, or
  wait for the multi-folder support.
- **The model list is magpie's.** MusePi shows what magpie's catalog had
  when the agent last connected; re-pick a model after adding a provider.
- **Thinking signatures.** Each model is written with the API magpie relays
  it on (`anthropic-messages`, `openai-responses`, or `openai-completions`),
  so a Claude model keeps its thinking across tool turns.

## Develop

```sh
node --test "test/*.test.mjs"
magpie plugin add .       # connect it from the folder itself
```

## Publishing

A GitHub repository needs the **`magpie-plugin`** topic for magpie to list
it under Plugins → Discover → Unofficial (searched every 10 minutes, no
review, sorted by stars). Being in the community's `registry.json`
(`magpie-community/plugins`) is a further step: it makes the plugin
installable by short name and suggested as an agent.

Neither is needed to install it: `magpie plugin add github:<owner>/<repo>`
works regardless.
