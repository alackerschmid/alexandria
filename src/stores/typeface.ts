import {
  DEFAULT_TYPEFACE,
  TYPEFACE_PRESETS,
  type TypefacePreset,
} from "@/utils/appearance";
import { createPresetStore } from "./createPresetStore";

export const useTypefaceStore = createPresetStore<TypefacePreset>(
  "typeface",
  "typeface",
  TYPEFACE_PRESETS,
  DEFAULT_TYPEFACE,
);
