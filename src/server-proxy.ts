import { createCallResult } from "./result-utils.js";
import type {
	CallOptions,
	ListToolsOptions,
	Runtime,
	ServerToolInfo,
} from "./runtime.js";

type ToolCallOptions = CallOptions & { args?: unknown };
type ToolArguments = CallOptions["args"];

type ServerProxy = {
	call(
		toolName: string,
		options?: ToolCallOptions,
	): Promise<ReturnType<typeof createCallResult>>;
	listTools(options?: ListToolsOptions): Promise<ServerToolInfo[]>;
};

function defaultToolNameMapper(propertyKey: string | symbol): string {
	if (typeof propertyKey !== "string") {
		throw new TypeError("Tool name must be a string when using server proxy.");
	}
	return propertyKey
		.replace(/_/g, "-")
		.replace(/([a-z\d])([A-Z])/g, "$1-$2")
		.toLowerCase();
}

function applyDefaults(schema: unknown, args: ToolArguments): ToolArguments {
	if (
		!schema ||
		typeof schema !== "object" ||
		(schema as Record<string, unknown>).type !== "object"
	) {
		return args;
	}

	const properties = (schema as Record<string, unknown>).properties;
	if (!properties || typeof properties !== "object") {
		return args;
	}

	if (!args || typeof args !== "object") {
		args = {} as ToolArguments;
	}

	const source: Record<string, unknown> = {
		...(args as Record<string, unknown>),
	};

	for (const [key, value] of Object.entries(properties)) {
		if (
			value &&
			typeof value === "object" &&
			"default" in (value as Record<string, unknown>) &&
			source[key] === undefined
		) {
			source[key] = (value as Record<string, unknown>).default as unknown;
		}
	}

	return source as ToolArguments;
}

function validateRequired(schema: unknown, args: ToolArguments): void {
	if (
		!schema ||
		typeof schema !== "object" ||
		(schema as Record<string, unknown>).type !== "object"
	) {
		return;
	}
	const required = (schema as Record<string, unknown>).required;
	if (!Array.isArray(required) || required.length === 0) {
		return;
	}
	if (!args || typeof args !== "object") {
		throw new Error(`Missing required arguments: ${required.join(", ")}`);
	}

	const missing = required.filter(
		(key) => (args as Record<string, unknown>)[key] === undefined,
	);

	if (missing.length > 0) {
		throw new Error(`Missing required arguments: ${missing.join(", ")}`);
	}
}

export function createServerProxy(
	runtime: Runtime,
	serverName: string,
	mapPropertyToTool: (
		property: string | symbol,
	) => string = defaultToolNameMapper,
): ServerProxy {
	const toolSchemaCache = new Map<string, unknown>();
	let schemaFetch: Promise<void> | null = null;

	async function ensureMetadata(toolName: string): Promise<unknown> {
		if (toolSchemaCache.has(toolName)) {
			return toolSchemaCache.get(toolName);
		}

		if (!schemaFetch) {
			schemaFetch = runtime
				.listTools(serverName, { includeSchema: true })
				.then((tools) => {
					for (const tool of tools) {
						const schema = tool.inputSchema;
						if (schema) {
							toolSchemaCache.set(tool.name, schema);
							const normalized = mapPropertyToTool(tool.name);
							toolSchemaCache.set(normalized, schema);
						}
					}
				})
				.catch((error) => {
					schemaFetch = null;
					throw error;
				});
		}

		await schemaFetch;
		return toolSchemaCache.get(toolName);
	}

	const base: ServerProxy = {
		call: async (toolName: string, options?: ToolCallOptions) => {
			const result = await runtime.callTool(
				serverName,
				toolName,
				options ?? {},
			);
			return createCallResult(result);
		},
		listTools: (options) => runtime.listTools(serverName, options),
	};

	return new Proxy(base as ServerProxy & Record<string | symbol, unknown>, {
		get(target, property, receiver) {
			if (Reflect.has(target, property)) {
				return Reflect.get(target, property, receiver);
			}

			const toolName = mapPropertyToTool(property);

			return async (...callArgs: unknown[]) => {
				const [firstArg, secondArg] = callArgs;
				const finalOptions: ToolCallOptions = {};

				if (typeof secondArg === "object" && secondArg !== null) {
					Object.assign(finalOptions, secondArg as ToolCallOptions);
				}

				if (firstArg !== undefined) {
					if (
						typeof firstArg === "object" &&
						firstArg !== null &&
						"args" in (firstArg as Record<string, unknown>) &&
						secondArg === undefined
					) {
						Object.assign(finalOptions, firstArg as ToolCallOptions);
					} else {
						finalOptions.args = firstArg as ToolArguments;
					}
				}

				let schema: unknown;
				try {
					schema = await ensureMetadata(toolName);
				} catch {
					schema = undefined;
				}
				if (schema) {
					if (finalOptions.args !== undefined) {
						finalOptions.args = applyDefaults(
							schema,
							finalOptions.args as ToolArguments,
						);
					} else {
						const defaults = applyDefaults(schema, undefined as ToolArguments);
						if (defaults && typeof defaults === "object") {
							finalOptions.args = defaults;
						}
					}
					validateRequired(schema, finalOptions.args as ToolArguments);
				}

				const result = await runtime.callTool(
					serverName,
					toolName,
					finalOptions,
				);
				return createCallResult(result);
			};
		},
	});
}
