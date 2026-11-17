// MusePi keeps its own providers in <agent dir>/models.yml and the model a
// new session starts on in <agent dir>/config.yml, under modelRoles.default
// as "provider/id". magpie adds itself there as the provider "magpie", with
// the key it keeps for MusePi, and the catalog as that provider's models, so
// a magpie model is "magpie/<provider>/<model>".
//
// Only the default folder (~/.musepi/agent) is wired. A named profile
// (MUSEPI_HOME / MUSEPI_PROFILE), PI_CONFIG_DIR or a Linux XDG data root
// moves MusePi's files, and agent.config is one fixed path: when one of
// those is in use magpie writes where MusePi does not look.

import { MUSEPI_ICON } from "./musepi.icon.js";

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
	// Gives the row magpie's effort field. MusePi keeps its own thinking
	// level per session (including its `auto`), so this is magpie asking the
	// gateway for a level on the way out — it writes nothing to MusePi's files
	// and does not touch a session's own pick.
	effort: true,
	// magpie reads this, not package.json's magpie.icon: the latter only
	// feeds the plugin market card.
	icon: MUSEPI_ICON,
	// Shown after every change. Keep it to what the person must do next: the
	// folder caveat is a standing limitation, so it belongs in the README, not
	// in a toast that reads like a failure.
	notice: "Start a new MusePi session to use the new model.",
};

/** MusePi's cost, from magpie's pricing: USD a token, as decimal strings. */
function toCost(pricing) {
	const number = value => {
		const n = Number(value);
		return Number.isFinite(n) ? n : 0;
	};
	return {
		input: number(pricing.prompt),
		output: number(pricing.completion),
		cacheRead: number(pricing.input_cache_read),
		cacheWrite: number(pricing.input_cache_write),
	};
}

/** The API MusePi should ask a model on, from the endpoints magpie relays. */
function apiFor(endpoints) {
	const list = Array.isArray(endpoints) ? endpoints : [];
	// Messages keeps a Claude model's thinking signatures between tool turns;
	// Chat has nowhere to put them.
	if (list.includes("/v1/messages")) return "anthropic-messages";
	if (list.includes("/v1/responses")) return "openai-responses";
	return "openai-completions";
}

export function connect({ gateway, models }) {
	const provider = { baseUrl: gateway.url, apiKey: gateway.key };
	const list = (models ?? []).map(model => {
		const entry = { id: model.id, name: model.name ?? model.id };
		if (model.context) entry.contextWindow = model.context;
		if (model.output) entry.maxTokens = model.output;
		entry.api = apiFor(model.native_endpoints);
		if (model.pricing) entry.cost = toCost(model.pricing);
		return entry;
	});
	// An empty list would leave MusePi a provider with no models at all, which
	// hides a real failure behind a selector that looks wired.
	if (list.length > 0) provider.models = list;
	return { "providers.magpie": provider };
}
