import assert from "node:assert/strict";
import test from "node:test";
import { agent, connect } from "../musepi.agent.js";

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
