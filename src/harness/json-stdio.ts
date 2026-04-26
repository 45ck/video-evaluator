import { stdin, stdout } from "node:process";
import type { ZodTypeAny } from "zod";

export interface HarnessTool<Input, Output> {
  tool: string;
  inputSchema: ZodTypeAny;
  handler: (params: { input: Input }) => Promise<Output>;
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

export async function runHarnessTool<Input, Output>(
  spec: HarnessTool<Input, Output>,
): Promise<void> {
  const raw = await readAllStdin();
  const parsedInput = raw.length === 0 ? {} : JSON.parse(raw);
  const input = spec.inputSchema.parse(parsedInput) as Input;
  const result = await spec.handler({ input });
  stdout.write(`${JSON.stringify({ tool: spec.tool, result }, null, 2)}\n`);
}
