import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useFieldDefsStore } from "@/stores/fieldDefs";
import type { GroupBy } from "@/types/library";

export interface CustomFieldMeta {
  def: { id: number; name: string; type: string };
  slug: string;
}

export interface DimensionOption {
  value: GroupBy;
  label: string;
}

// Must match the builtin search/group keys used in index.vue to avoid slug collisions
const BUILTIN_SLUGS = new Set([
  "status",
  "owning",
  "rating",
  "author",
  "genre",
  "series",
  "publisher",
  "language",
  "award",
  "form",
  "country",
  "year",
  "subject",
  "location",
  "title",
  "isbn",
]);

export function useGroupDimensions() {
  const { t } = useI18n();
  const fieldDefsStore = useFieldDefsStore();

  const customFieldMetas = computed<CustomFieldMeta[]>(() => {
    const used = new Set<string>(BUILTIN_SLUGS);
    return fieldDefsStore.defs.map((def) => {
      let slug =
        def.name.toLowerCase().replace(/[^a-z0-9]+/g, "") || `field${def.id}`;
      if (used.has(slug)) slug = `${slug}${def.id}`;
      used.add(slug);
      return { def, slug };
    });
  });

  // All groupable dimensions — no 'none'. Used by home page dropdowns.
  const dimensionOptions = computed<DimensionOption[]>(() => [
    { value: "author", label: t("library.group_author") },
    { value: "series", label: t("library.group_series") },
    { value: "genre", label: t("library.group_genre") },
    { value: "status", label: t("library.group_status") },
    { value: "owning", label: t("library.group_owning") },
    { value: "rating", label: t("library.group_rating") },
    { value: "publisher", label: t("library.group_publisher") },
    { value: "language", label: t("library.group_language") },
    { value: "form", label: t("library.group_form") },
    { value: "country", label: t("library.group_country") },
    { value: "decade", label: t("library.group_decade") },
    { value: "subject", label: t("library.group_subject") },
    ...customFieldMetas.value
      .filter((m) => m.def.type !== "date" && m.def.type !== "integer")
      .map((m) => ({ value: `cf:${m.def.id}` as GroupBy, label: m.def.name })),
  ]);

  // Full list including 'none' — used by the library toolbar.
  const groupOptions = computed<DimensionOption[]>(() => [
    { value: "none", label: t("library.group_none") },
    ...dimensionOptions.value,
  ]);

  return { dimensionOptions, groupOptions, customFieldMetas };
}
