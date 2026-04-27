import { extractVideoShots } from "../core/video-shots.js";
import { VideoShotsRequestSchema, type VideoShotsRequest } from "../core/schemas.js";

export async function runVideoShots(input: VideoShotsRequest) {
  return extractVideoShots(input);
}

export { VideoShotsRequestSchema };
