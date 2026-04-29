import {
  analyzeVideo,
  AnalyzeVideoRequestSchema,
  type AnalyzeVideoRequest,
} from "../analysis/index.js";

export async function runAnalyzeVideo(input: AnalyzeVideoRequest) {
  return analyzeVideo(input);
}

export { AnalyzeVideoRequestSchema };
