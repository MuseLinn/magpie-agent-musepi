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
			// MusePi prices a million tokens: magpie's per-token 3e-7 is $0.30.
			cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0 },
		},
	]);
});

test("a per-token price becomes MusePi's per-million rate without float noise", () => {
	const out = connect({
		gateway,
		models: [{ id: "x/y", pricing: { prompt: "0.00000015", completion: "0.0000006" } }],
	});
	const [model] = out["providers.magpie"].models;
	assert.equal(model.cost.input, 0.15);
	assert.equal(model.cost.output, 0.6);
});

test("an image model declares image input, a text-only one leaves it to MusePi", () => {
	const models = connect({
		gateway,
		models: [
			{ id: "x/vision", images: true },
			{ id: "x/text", images: false },
		],
	})["providers.magpie"].models;
	assert.deepEqual(models[0].input, ["text", "image"]);
	assert.equal(models[1].input, undefined);
});

test("magpie's effort ladder becomes MusePi's thinking ladder", () => {
	const [chat] = connect({
		gateway,
		models: [{ id: "x/reasoner", efforts: ["high", "low", "medium"] }],
	})["providers.magpie"].models;
	assert.equal(chat.reasoning, true);
	assert.deepEqual(chat.thinking, { mode: "effort", efforts: ["low", "medium", "high"] });
});

test("an unknown effort never reaches the file MusePi validates whole", () => {
	const [chat] = connect({
		gateway,
		models: [{ id: "x/reasoner", efforts: ["low", "turbo"] }],
	})["providers.magpie"].models;
	assert.deepEqual(chat.thinking.efforts, ["low"]);
});

test("an Anthropic model keeps its reasoning flag and no pinned mode", () => {
	// MusePi picks anthropic-adaptive / budget-effort from the model's id; a
	// mode written here would overrule that.
	const [messages] = connect({
		gateway,
		models: [{ id: "a/claude", native_endpoints: ["/v1/messages"], efforts: ["low", "high"] }],
	})["providers.magpie"].models;
	assert.equal(messages.reasoning, true);
	assert.equal(messages.thinking, undefined);
});

test("no efforts means no reasoning claim", () => {
	const [plain] = connect({ gateway, models: [{ id: "x/plain", efforts: [] }] })[
		"providers.magpie"
	].models;
	assert.equal(plain.reasoning, undefined);
	assert.equal(plain.thinking, undefined);
});

test("a Responses model asks the gateway's /v1, where /responses lives", () => {
	// MusePi appends /responses to the model's base URL; magpie serves it at
	// /v1/responses only, so the provider root would 404.
	const models = connect({
		gateway,
		models: [
			{ id: "x/gpt", native_endpoints: ["/v1/responses"] },
			{ id: "x/chat", native_endpoints: ["/v1/chat/completions"] },
			{ id: "x/claude", native_endpoints: ["/v1/messages"] },
		],
	})["providers.magpie"].models;
	assert.equal(models[0].baseUrl, "http://127.0.0.1:3425/v1");
	assert.equal(models[1].baseUrl, undefined);
	assert.equal(models[2].baseUrl, undefined);
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
