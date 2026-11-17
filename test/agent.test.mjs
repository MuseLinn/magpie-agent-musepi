import assert from "node:assert/strict";
import test from "node:test";
import { agent, connect } from "../musepi.agent.js";

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

test("the module imports nothing (moejs has no Node)", async () => {
	const { readFile } = await import("node:fs/promises");
	const src = await readFile(new URL("../musepi.agent.js", import.meta.url), "utf8");
	assert.equal(/^\s*import\s/m.test(src), false, "musepi.agent.js must not import anything");
});

test("the notice names the folder limit", () => {
	assert.match(agent.notice, /default folder/i);
});
