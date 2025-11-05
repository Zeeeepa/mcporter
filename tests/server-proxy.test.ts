import { describe, expect, it, vi } from "vitest";
import type { CallResult } from "../src/index.js";
import type { Runtime, ServerToolInfo } from "../src/runtime";
import { createServerProxy } from "../src/server-proxy";

function createMockRuntime(
	toolSchemas: Record<string, unknown> = {},
	listToolsImpl?: () => Promise<ServerToolInfo[]>,
) {
	const listTools = listToolsImpl
		? vi.fn(listToolsImpl)
		: vi.fn(async () =>
				Object.entries(toolSchemas).map(([name, schema]) => ({
					name,
					description: "",
					inputSchema: schema,
				})),
			);
	return {
		callTool: vi.fn(async (_, __, options) => options),
		listTools,
	};
}

describe("createServerProxy", () => {
	it("maps camelCase property names to kebab-case tool names", async () => {
		const runtime = createMockRuntime();
		const context7 = createServerProxy(
			runtime as unknown as Runtime,
			"context7",
		) as Record<string, unknown>;

		const resolver = context7.resolveLibraryId as (
			args: unknown,
		) => Promise<CallResult>;
		const result = await resolver({ libraryName: "react" });

		expect(runtime.callTool).toHaveBeenCalledWith(
			"context7",
			"resolve-library-id",
			{ args: { libraryName: "react" } },
		);
		expect(result.raw).toEqual({ args: { libraryName: "react" } });
	});

	it("merges args and options when both are provided", async () => {
		const runtime = createMockRuntime();
		const proxy = createServerProxy(
			runtime as unknown as Runtime,
			"foo",
		) as Record<string, unknown>;

		const fn = proxy.someTool as (
			args: unknown,
			options: unknown,
		) => Promise<CallResult>;
		const result = await fn({ foo: "bar" }, { tailLog: true });

		expect(runtime.callTool).toHaveBeenCalledWith("foo", "some-tool", {
			args: { foo: "bar" },
			tailLog: true,
		});
		expect(result.raw).toEqual({ args: { foo: "bar" }, tailLog: true });
	});

	it("supports passing full call options as the first argument", async () => {
		const runtime = createMockRuntime();
		const proxy = createServerProxy(
			runtime as unknown as Runtime,
			"bar",
		) as Record<string, unknown>;

		const fn = proxy.otherTool as (options: unknown) => Promise<CallResult>;
		const result = await fn({ args: { value: 1 }, tailLog: true });

		expect(runtime.callTool).toHaveBeenCalledWith("bar", "other-tool", {
			args: { value: 1 },
			tailLog: true,
		});
		expect(result.raw).toEqual({ args: { value: 1 }, tailLog: true });
	});

	it("applies schema defaults and validates required arguments", async () => {
		const runtime = createMockRuntime({
			someTool: {
				type: "object",
				properties: {
					foo: { type: "number", default: 42 },
					bar: { type: "string" },
				},
				required: ["foo"],
			},
			otherTool: {
				type: "object",
				required: ["value"],
			},
		});

		const proxy = createServerProxy(
			runtime as unknown as Runtime,
			"test",
		) as Record<string, unknown>;

		const someTool = proxy.someTool as (
			options?: unknown,
		) => Promise<CallResult>;
		const result = await someTool({ bar: "baz" });

		expect(runtime.callTool).toHaveBeenCalledWith("test", "some-tool", {
			args: { foo: 42, bar: "baz" },
		});
		expect(result.raw).toEqual({ args: { foo: 42, bar: "baz" } });

		const otherTool = proxy.otherTool as () => Promise<CallResult>;
		await expect(otherTool()).rejects.toThrow("Missing required arguments");
		expect(runtime.callTool).toHaveBeenCalledTimes(1);
	});

	it("continues when metadata fetch fails", async () => {
		const runtime = createMockRuntime({}, () =>
			Promise.reject(new Error("metadata failure")),
		);

		const proxy = createServerProxy(
			runtime as unknown as Runtime,
			"foo",
		) as Record<string, unknown>;

		const fn = proxy.someTool as (args: unknown) => Promise<CallResult>;
		const result = await fn({ foo: "bar" });

		expect(runtime.callTool).toHaveBeenCalledWith("foo", "some-tool", {
			args: { foo: "bar" },
		});
		expect(result.raw).toEqual({ args: { foo: "bar" } });
	});
});
