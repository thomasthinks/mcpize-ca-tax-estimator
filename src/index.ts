import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";
import { z } from "zod";
import chalk from "chalk";
import { estimateTax, marginalRate, compareRrspTfsa } from "./tools.js";
import { checkAndConsumeEstimate } from "./usage.js";
import { PROVINCE_CODES } from "./tax-data.js";

// ============================================================================
// Dev Logging Utilities
// ============================================================================

const isDev = process.env.NODE_ENV !== "production";

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function formatLatency(ms: number): string {
  if (ms < 100) return chalk.green(`${ms}ms`);
  if (ms < 500) return chalk.yellow(`${ms}ms`);
  return chalk.red(`${ms}ms`);
}

function truncate(str: string, maxLen = 60): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

function logRequest(method: string, params?: unknown): void {
  if (!isDev) return;

  const paramsStr = params ? chalk.gray(` ${truncate(JSON.stringify(params))}`) : "";
  console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.cyan("→")} ${method}${paramsStr}`);
}

function logResponse(method: string, result: unknown, latencyMs: number): void {
  if (!isDev) return;

  const latency = formatLatency(latencyMs);

  // For tool calls, show the result
  if (method === "tools/call" && result) {
    const resultStr = typeof result === "string" ? result : JSON.stringify(result);
    console.log(
      `${chalk.gray(`[${timestamp()}]`)} ${chalk.green("←")} ${truncate(resultStr)} ${chalk.gray(`(${latency})`)}`
    );
  } else {
    console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.green("✓")} ${method} ${chalk.gray(`(${latency})`)}`);
  }
}

function logError(method: string, error: unknown, latencyMs: number): void {
  const latency = formatLatency(latencyMs);

  let errorMsg: string;
  if (error instanceof Error) {
    errorMsg = error.message;
  } else if (typeof error === "object" && error !== null) {
    // JSON-RPC error object has { code, message, data? }
    const rpcError = error as { message?: string; code?: number };
    errorMsg = rpcError.message || `Error ${rpcError.code || "unknown"}`;
  } else {
    errorMsg = String(error);
  }

  console.log(
    `${chalk.gray(`[${timestamp()}]`)} ${chalk.red("✖")} ${method} ${chalk.red(truncate(errorMsg))} ${chalk.gray(`(${latency})`)}`
  );
}

// ============================================================================
// MCP Server Setup
// ============================================================================

// Build a FRESH MCP server per request.
//
// In stateless streamable-HTTP mode the MCP SDK allows a Server to be connected
// to exactly ONE transport. Reusing a single module-scope instance throws
// "Already connected to a transport" on the second connection — and Cloud Run
// opens several (startup probe + real requests). So always create a new server
// (and a new transport) inside the request handler below.
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "ca-tax-estimator",
    version: "1.0.0",
  });

  const ProvinceCode = z
    .enum(PROVINCE_CODES as [string, ...string[]])
    .describe(
      "2-letter Canadian province/territory code of residence on Dec 31 of the tax year (BC, AB, SK, MB, ON, QC, NB, NS, PE, NL, YT, NT, NU)."
    );
  const Income = z
    .number()
    .min(0)
    .describe("Annual taxable income in CAD (employment/other income before credits). Must be >= 0.");

  const quotaError = (message: string) => ({
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    structuredContent: { error: message } as Record<string, unknown>,
    isError: true as const,
  });

  const toolError = (tool: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${tool}] Error:`, message);
    const body = {
      error: message,
      suggestion: "Check that income is a non-negative number and province is a valid 2-letter Canadian code.",
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(body) }],
      structuredContent: body as Record<string, unknown>,
      isError: true as const,
    };
  };

  // Register the estimate_tax tool (quota-gated: Free plan = N estimates/month)
  server.registerTool(
    "estimate_tax",
    {
      title: "Estimate Canadian Income Tax (2026)",
      description:
        "Estimate 2026 Canadian federal + provincial/territorial income tax for a given taxable income and province of residence. Basic personal amount is the only credit applied. Estimates only — not tax advice.",
      inputSchema: {
        income: Income,
        province: ProvinceCode,
      },
      outputSchema: {
        income: z.number(),
        province: z.string(),
        tax_year: z.number(),
        federal_tax: z.number(),
        provincial_tax: z.number(),
        total_tax: z.number(),
        after_tax_income: z.number(),
        marginal_rate: z.number(),
        average_rate: z.number(),
        federal_bpa_credit: z.number(),
        provincial_bpa_credit: z.number(),
        ontario_health_premium: z.number(),
        quebec_federal_abatement_applied: z.boolean(),
        notes: z.array(z.string()),
      },
    },
    async ({ income, province }) => {
      try {
        const quota = checkAndConsumeEstimate();
        if (!quota.allowed) return quotaError(quota.message!);
        const output = estimateTax(income, province);
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error) {
        return toolError("estimate_tax", error);
      }
    }
  );

  // Register the compare_rrsp_tfsa tool
  server.registerTool(
    "compare_rrsp_tfsa",
    {
      title: "Compare RRSP vs TFSA Contribution",
      description:
        "Compare an RRSP contribution (deductible at your combined marginal rate) against a TFSA contribution (after-tax, tax-free growth/withdrawals) for a given income and province. General information only — not tax advice.",
      inputSchema: {
        income: Income,
        province: ProvinceCode,
        contribution: z
          .number()
          .min(0)
          .describe("Contribution amount in CAD to compare. Must be >= 0."),
      },
      outputSchema: {
        income: z.number(),
        province: z.string(),
        tax_year: z.number(),
        contribution: z.number(),
        marginal_rate: z.number(),
        rrsp_tax_saving: z.number(),
        effective_cost: z.number(),
        tfsa_note: z.string(),
        recommendation_note: z.string(),
      },
    },
    async ({ income, province, contribution }) => {
      try {
        const output = compareRrspTfsa(income, province, contribution);
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error) {
        return toolError("compare_rrsp_tfsa", error);
      }
    }
  );

  // Register the marginal_rate tool
  server.registerTool(
    "marginal_rate",
    {
      title: "Combined Marginal Tax Rate",
      description:
        "Combined federal + provincial/territorial statutory marginal tax rate on the next dollar of income, with the containing bracket floor/ceiling. Excludes BPA phase-outs, surtaxes and the Ontario Health Premium.",
      inputSchema: {
        income: Income,
        province: ProvinceCode,
      },
      outputSchema: {
        income: z.number(),
        province: z.string(),
        tax_year: z.number(),
        marginal_rate: z.number(),
        federal_component: z.number(),
        provincial_component: z.number(),
        bracket_floor: z.number(),
        bracket_ceiling: z.number().nullable(),
        notes: z.array(z.string()),
      },
    },
    async ({ income, province }) => {
      try {
        const output = marginalRate(income, province);
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error) {
        return toolError("marginal_rate", error);
      }
    }
  );

  return server;
}

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();
app.use(express.json());

// Health check endpoint (required for Cloud Run)
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "healthy" });
});

// MCP endpoint with dev logging
app.post("/mcp", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const body = req.body;

  // Extract method and params from JSON-RPC request
  const method = body?.method || "unknown";
  const params = body?.params;

  // Log incoming request
  if (method === "tools/call") {
    const toolName = params?.name || "unknown";
    const toolArgs = params?.arguments;
    logRequest(`tools/call ${chalk.bold(toolName)}`, toolArgs);
  } else if (method !== "notifications/initialized") {
    logRequest(method, params);
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  // Capture response body for logging
  let responseBody = "";
  const originalWrite = res.write.bind(res) as typeof res.write;
  const originalEnd = res.end.bind(res) as typeof res.end;

  res.write = function (chunk: unknown, encodingOrCallback?: BufferEncoding | ((error: Error | null | undefined) => void), callback?: (error: Error | null | undefined) => void) {
    if (chunk) {
      responseBody += typeof chunk === "string" ? chunk : Buffer.from(chunk as ArrayBuffer).toString();
    }
    return originalWrite(chunk as string, encodingOrCallback as BufferEncoding, callback);
  };

  res.end = function (chunk?: unknown, encodingOrCallback?: BufferEncoding | (() => void), callback?: () => void) {
    if (chunk) {
      responseBody += typeof chunk === "string" ? chunk : Buffer.from(chunk as ArrayBuffer).toString();
    }

    // Log response
    if (method !== "notifications/initialized") {
      const latency = Date.now() - startTime;

      try {
        const rpcResponse = JSON.parse(responseBody) as { result?: unknown; error?: unknown };

        if (rpcResponse?.error) {
          logError(method, rpcResponse.error, latency);
        } else if (method === "tools/call") {
          const content = (rpcResponse?.result as { content?: Array<{ text?: string }> })?.content;
          const resultText = content?.[0]?.text;
          logResponse(method, resultText, latency);
        } else {
          logResponse(method, null, latency);
        }
      } catch {
        logResponse(method, null, latency);
      }
    }

    return originalEnd(chunk as string, encodingOrCallback as BufferEncoding, callback);
  };

  res.on("close", () => {
    transport.close();
  });

  // Fresh server instance per request (see createMcpServer above) — required for
  // stateless streamable-HTTP so a second connection never reuses a transport.
  const server = createMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// JSON error handler (Express defaults to HTML errors)
app.use((_err: unknown, _req: Request, res: Response, _next: Function) => {
  res.status(500).json({ error: "Internal server error" });
});

// ============================================================================
// Start Server
// ============================================================================

const port = parseInt(process.env.PORT || "8080");
const httpServer = app.listen(port, () => {
  console.log();
  console.log(chalk.bold("MCP Server running on"), chalk.cyan(`http://localhost:${port}`));
  console.log(`  ${chalk.gray("Health:")} http://localhost:${port}/health`);
  console.log(`  ${chalk.gray("MCP:")}    http://localhost:${port}/mcp`);

  if (isDev) {
    console.log();
    console.log(chalk.gray("─".repeat(50)));
    console.log();
  }
});

// Graceful shutdown for Cloud Run (SIGTERM before kill)
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down...");
  httpServer.close(() => {
    process.exit(0);
  });
});
