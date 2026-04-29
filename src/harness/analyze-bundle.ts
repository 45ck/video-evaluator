import {
  analyzeBundle,
  AnalyzeBundleRequestSchema,
  type AnalyzeBundleRequest,
} from "../analysis/index.js";

export async function runAnalyzeBundle(input: AnalyzeBundleRequest) {
  return analyzeBundle(input);
}

export { AnalyzeBundleRequestSchema };
