import {
  GoldenFrameCompareRequestSchema,
  type GoldenFrameCompareRequest,
} from "../core/schemas.js";
import { compareGoldenFrame } from "../visual/golden-frame.js";

export async function runGoldenFrameCompare(input: GoldenFrameCompareRequest) {
  return compareGoldenFrame(input);
}

export { GoldenFrameCompareRequestSchema };
