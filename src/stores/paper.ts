import {
  DEFAULT_PAPER,
  PAPER_PRESETS,
  type PaperPreset,
} from "@/utils/appearance";
import { createPresetStore } from "./createPresetStore";

export const usePaperStore = createPresetStore<PaperPreset>(
  "paper",
  "paper",
  PAPER_PRESETS,
  DEFAULT_PAPER,
);
