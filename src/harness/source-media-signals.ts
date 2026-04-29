import { buildSourceMediaSignals } from "../source-media/signals.js";
import {
  SourceMediaSignalsRequestSchema,
  type SourceMediaSignalsRequest,
} from "../core/schemas.js";

export async function runSourceMediaSignals(input: SourceMediaSignalsRequest) {
  return buildSourceMediaSignals(input);
}

export { SourceMediaSignalsRequestSchema };
