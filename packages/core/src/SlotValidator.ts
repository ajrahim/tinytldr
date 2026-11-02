import type { SlotDefinition, TemplateManifest } from "./TemplateManifest.js";

export interface SlotValidationIssue {
  slot: string;
  code:
    | "missing-required"
    | "invalid-type"
    | "max-length"
    | "recommended-length"
    | "min-items"
    | "max-items"
    | "invalid-enum"
    | "remote-asset-blocked"
    | "unknown-slot";
  message: string;
}

export interface SlotValidationResult {
  valid: boolean;
  normalizedData: Record<string, unknown>;
  errors: SlotValidationIssue[];
  warnings: SlotValidationIssue[];
}

export interface ValidateSlotDataOptions {
  allowRemoteAssets?: boolean;
}

function validateSingleSlot(
  slotKey: string,
  def: SlotDefinition,
  rawVal: unknown,
  options: ValidateSlotDataOptions,
  errors: SlotValidationIssue[],
  warnings: SlotValidationIssue[],
): unknown {
  const val = rawVal === undefined || rawVal === null ? def.defaultValue : rawVal;

  if (val === undefined || val === null || val === "") {
    if (def.required) {
      errors.push({
        slot: slotKey,
        code: "missing-required",
        message: `Slot '${slotKey}' (${def.label}) is required.`,
      });
    }
    if (def.type === "string[]") return [];
    if (def.type === "slides" || def.type === "object[]") return [];
    if (def.type === "boolean") return false;
    return "";
  }

  switch (def.type) {
    case "string":
    case "code":
    case "enum":
    case "image": {
      if (typeof val !== "string") {
        errors.push({
          slot: slotKey,
          code: "invalid-type",
          message: `Slot '${slotKey}' must be a string (received ${typeof val}).`,
        });
        return String(val);
      }

      if (def.maxLength !== undefined && val.length > def.maxLength) {
        errors.push({
          slot: slotKey,
          code: "max-length",
          message: `Slot '${slotKey}' length (${val.length}) exceeds maxLength (${def.maxLength}).`,
        });
      } else if (def.recommendedMaxLength !== undefined && val.length > def.recommendedMaxLength) {
        warnings.push({
          slot: slotKey,
          code: "recommended-length",
          message: `Slot '${slotKey}' length (${val.length}) exceeds recommendedMaxLength (${def.recommendedMaxLength}); auto-fit may shrink font size.`,
        });
      }

      if (
        def.type === "enum" &&
        def.enumValues &&
        def.enumValues.length > 0 &&
        !def.enumValues.includes(val)
      ) {
        errors.push({
          slot: slotKey,
          code: "invalid-enum",
          message: `Slot '${slotKey}' must be one of [${def.enumValues.join(", ")}] (received '${val}').`,
        });
      }

      if (def.type === "image" && !options.allowRemoteAssets) {
        const trimmed = val.trim().toLowerCase();
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
          errors.push({
            slot: slotKey,
            code: "remote-asset-blocked",
            message: `Slot '${slotKey}' uses a remote URL ('${val}'), which is blocked by default for deterministic offline rendering. Pass allowRemoteAssets: true or use a local file / data URL.`,
          });
        }
      }

      return val;
    }

    case "number": {
      if (typeof val !== "number" || !Number.isFinite(val)) {
        errors.push({
          slot: slotKey,
          code: "invalid-type",
          message: `Slot '${slotKey}' must be a finite number.`,
        });
        return 0;
      }
      return val;
    }

    case "boolean": {
      if (typeof val !== "boolean") {
        errors.push({
          slot: slotKey,
          code: "invalid-type",
          message: `Slot '${slotKey}' must be a boolean.`,
        });
        return Boolean(val);
      }
      return val;
    }

    case "string[]": {
      if (!Array.isArray(val) || !val.every((item) => typeof item === "string")) {
        errors.push({
          slot: slotKey,
          code: "invalid-type",
          message: `Slot '${slotKey}' must be an array of strings.`,
        });
        return [];
      }
      if (def.minItems !== undefined && val.length < def.minItems) {
        errors.push({
          slot: slotKey,
          code: "min-items",
          message: `Slot '${slotKey}' requires at least ${def.minItems} items (received ${val.length}).`,
        });
      }
      if (def.maxItems !== undefined && val.length > def.maxItems) {
        errors.push({
          slot: slotKey,
          code: "max-items",
          message: `Slot '${slotKey}' allows at most ${def.maxItems} items (received ${val.length}).`,
        });
      }
      for (let i = 0; i < val.length; i++) {
        const item = val[i] ?? "";
        if (def.maxLength !== undefined && item.length > def.maxLength) {
          errors.push({
            slot: `${slotKey}[${i}]`,
            code: "max-length",
            message: `Item ${i + 1} in '${slotKey}' length (${item.length}) exceeds maxLength (${def.maxLength}).`,
          });
        } else if (
          def.recommendedMaxLength !== undefined &&
          item.length > def.recommendedMaxLength
        ) {
          warnings.push({
            slot: `${slotKey}[${i}]`,
            code: "recommended-length",
            message: `Item ${i + 1} in '${slotKey}' length (${item.length}) exceeds recommendedMaxLength (${def.recommendedMaxLength}).`,
          });
        }
      }
      return val;
    }

    case "slides":
    case "object[]": {
      if (
        !Array.isArray(val) ||
        !val.every((item) => item && typeof item === "object" && !Array.isArray(item))
      ) {
        errors.push({
          slot: slotKey,
          code: "invalid-type",
          message: `Slot '${slotKey}' must be an array of objects.`,
        });
        return [];
      }
      if (def.minItems !== undefined && val.length < def.minItems) {
        errors.push({
          slot: slotKey,
          code: "min-items",
          message: `Slot '${slotKey}' requires at least ${def.minItems} items (received ${val.length}).`,
        });
      }
      if (def.maxItems !== undefined && val.length > def.maxItems) {
        errors.push({
          slot: slotKey,
          code: "max-items",
          message: `Slot '${slotKey}' allows at most ${def.maxItems} items (received ${val.length}).`,
        });
      }
      if (def.itemSchema) {
        for (let i = 0; i < val.length; i++) {
          const itemObj = val[i] as Record<string, unknown>;
          for (const [fieldKey, fieldDef] of Object.entries(def.itemSchema)) {
            const fieldVal = itemObj[fieldKey];
            if (
              fieldDef.required &&
              (fieldVal === undefined || fieldVal === null || fieldVal === "")
            ) {
              errors.push({
                slot: `${slotKey}[${i}].${fieldKey}`,
                code: "missing-required",
                message: `Field '${fieldKey}' in '${slotKey}[${i}]' is required.`,
              });
              continue;
            }
            if (
              typeof fieldVal === "string" &&
              fieldDef.maxLength !== undefined &&
              fieldVal.length > fieldDef.maxLength
            ) {
              errors.push({
                slot: `${slotKey}[${i}].${fieldKey}`,
                code: "max-length",
                message: `Field '${fieldKey}' in '${slotKey}[${i}]' length (${fieldVal.length}) exceeds maxLength (${fieldDef.maxLength}).`,
              });
            }
          }
        }
      }
      return val;
    }
  }
}

export function validateSlotData(
  manifest: TemplateManifest,
  inputData: Record<string, unknown>,
  options: ValidateSlotDataOptions = {},
): SlotValidationResult {
  const errors: SlotValidationIssue[] = [];
  const warnings: SlotValidationIssue[] = [];
  const normalizedData: Record<string, unknown> = {};

  for (const [slotKey, def] of Object.entries(manifest.slots)) {
    normalizedData[slotKey] = validateSingleSlot(
      slotKey,
      def,
      inputData[slotKey],
      options,
      errors,
      warnings,
    );
  }

  for (const providedKey of Object.keys(inputData)) {
    if (!(providedKey in manifest.slots)) {
      warnings.push({
        slot: providedKey,
        code: "unknown-slot",
        message: `Unknown slot '${providedKey}' is not defined in template '${manifest.id}' and will be ignored.`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    normalizedData,
    errors,
    warnings,
  };
}
