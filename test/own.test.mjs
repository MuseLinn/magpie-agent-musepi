import assert from "node:assert/strict";
import test from "node:test";
import { own } from "../musepi.agent.js";

const config = {
	providers: {
		magpie: {
			baseUrl: "http://127.0.0.1:3425",
			apiKey: "magpie-musepi",
			models: [{ id: "deepseek/v4-pro" }],
		},
		"my-gw": {
			label: "My Gateway",
			baseUrl: "https://gw.example/v1",
			models: [{ id: "z/model" }, { id: "a/model" }],
		},
		bare: {
			baseUrl: "https://bare.example/v1",
			models: [{ id: "only" }],
		},
		"no-models": { baseUrl: "https://empty.example/v1" },
	},
};

test("magpie's own provider is not offered as a direct model", () => {
	const values = own({ config, model: "" }).map(option => option.value);
	assert.ok(!values.includes("magpie/deepseek/v4-pro"));
});

test("each declared model is a provider/id pick with its vendor", () => {
	assert.deepEqual(own({ config, model: "" }), [
		{ value: "bare/only", model: "only", direct: "bare" },
		{ value: "my-gw/a/model", model: "a/model", direct: "My Gateway" },
		{ value: "my-gw/z/model", model: "z/model", direct: "My Gateway" },
	]);
});

test("a provider with no models list contributes nothing", () => {
	assert.ok(!own({ config, model: "" }).some(option => option.value.startsWith("no-models/")));
});

test("the current own pick is kept even when the file does not name it", () => {
	// A bundled provider's model: MusePi is on it, models.yml never declared it.
	const first = own({ config, model: "agnes/agnes-3.0-flash" })[0];
	assert.deepEqual(first, {
		value: "agnes/agnes-3.0-flash",
		model: "agnes-3.0-flash",
		direct: "agnes",
	});
});

test("a magpie pick is not carried, and a listed pick is not repeated", () => {
	const magpie = own({ config, model: "magpie/deepseek/v4-pro" }).map(option => option.value);
	assert.ok(!magpie.includes("magpie/deepseek/v4-pro"));

	const listed = own({ config, model: "bare/only" }).filter(option => option.value === "bare/only");
	assert.equal(listed.length, 1);
});

test("no providers file means no options", () => {
	assert.deepEqual(own({ config: {}, model: "" }), []);
	assert.deepEqual(own({ config: undefined, model: "" }), []);
});