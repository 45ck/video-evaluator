import { intakeBundle } from "../core/bundle.js";
import { VideoIntakeRequestSchema, type VideoIntakeRequest } from "../core/schemas.js";

export async function runVideoIntake(input: VideoIntakeRequest) {
  return intakeBundle(input);
}

export { VideoIntakeRequestSchema };
