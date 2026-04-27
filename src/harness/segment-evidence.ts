import { buildSegmentEvidence } from "../core/segment-evidence.js";
import {
  SegmentEvidenceRequestSchema,
  type SegmentEvidenceRequest,
} from "../core/schemas.js";

export async function runSegmentEvidence(input: SegmentEvidenceRequest) {
  return buildSegmentEvidence(SegmentEvidenceRequestSchema.parse(input));
}

export { SegmentEvidenceRequestSchema };
