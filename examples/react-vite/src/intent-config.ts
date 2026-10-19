import type { EngineConfig } from 'oracular';
import { presets } from 'oracular/presets';

/** The upgrade preset as shipped, with a 30-minute idle gap closing sessions on its own. */
export const config: EngineConfig = {
  episodeTimeout: 30 * 60 * 1000,
  intents: { upgrade: presets.upgrade },
};
