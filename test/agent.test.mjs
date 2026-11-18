import assert from "node:assert/strict";
import test from "node:test";
import { agent, connect, own } from "../musepi.agent.js";

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

test("the module exports own, so the row can list MusePi's own models", () => {
	assert.equal(typeof own, "function");
	assert.deepEqual(own({ config: { providers: {} }, model: "" }), []);
});

test("the module imports only its own files (jsmod allows nothing else)", async () => {
	const { readFile } = await import("node:fs/promises");
	const src = await readFile(new URL("../musepi.agent.js", import.meta.url), "utf8");
	const specs = [...src.matchAll(/^\s*import\s[^"']*["']([^"']+)["']/gm)].map(m => m[1]);
	for (const spec of specs) {
		assert.match(spec, /^\.\//, `import ${spec}: magpie imports only files beside the module`);
	}
});

test("the agent carries an icon magpie can show", () => {
	assert.match(agent.icon, /^data:image\/png;base64,/);
	assert.ok(agent.icon.length > 1000, "the icon is the rendered PNG, not a placeholder");
});

test("the notice says what to do next and nothing more", () => {
	// MusePi re-reads models.yml when its model menu opens; a build from before
	// that reads it at session start, so the advice names both.
	assert.match(agent.notice, /model menu/i);
	assert.match(agent.notice, /new session/i);
	// The folder caveat is a standing limitation; a toast carrying it reads as
	// a failure on every model change.
	assert.doesNotMatch(agent.notice, /XDG|PI_CONFIG_DIR|profile/i);
	assert.ok(agent.notice.length < 90);
});

test("the row offers magpie's thinking level", () => {
	assert.equal(agent.effort, true);
});
