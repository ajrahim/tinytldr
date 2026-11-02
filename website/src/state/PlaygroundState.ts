import {
  getTemplateDetails,
  type CustomDimensions,
  type EditableThemeTokenKey,
  type SizePresetId,
  type TemplateManifest,
} from "../lib/BrowserCompiler.js";

export interface PlaygroundDesignState {
  readonly templateId: string;
  readonly manifest: TemplateManifest;
  readonly sizeMode: "preset" | "custom";
  readonly sizePreset: SizePresetId;
  readonly customDimensions: CustomDimensions;
  readonly theme: string;
  readonly tokenOverrides: Partial<Record<EditableThemeTokenKey, string>>;
  readonly slotData: Record<string, unknown>;
  readonly activeSlideIndex: number;
  readonly showSafeZone: boolean;
  readonly seekMs: number;
  readonly isPlaying: boolean;
  readonly revision: number;
}

export type PlaygroundAction =
  | {
      readonly type: "SELECT_TEMPLATE";
      readonly templateId: string;
      readonly sizePreset?: SizePresetId;
      readonly theme?: string;
    }
  | { readonly type: "SET_SIZE_PRESET"; readonly sizePreset: SizePresetId }
  | { readonly type: "SET_CUSTOM_DIMENSIONS"; readonly width: number; readonly height: number }
  | { readonly type: "SET_THEME"; readonly theme: string }
  | {
      readonly type: "SET_TOKEN_OVERRIDE";
      readonly token: EditableThemeTokenKey;
      readonly value: string;
    }
  | { readonly type: "RESET_TOKEN_OVERRIDES" }
  | { readonly type: "UPDATE_SLOT_VALUE"; readonly slotName: string; readonly value: unknown }
  | { readonly type: "REPLACE_SLOT_DATA"; readonly data: Record<string, unknown> }
  | { readonly type: "RESET_SLOTS_TO_SAMPLE" }
  | { readonly type: "SET_ACTIVE_SLIDE"; readonly slideIndex: number }
  | { readonly type: "TOGGLE_SAFE_ZONE"; readonly enabled?: boolean }
  | { readonly type: "SET_SEEK_MS"; readonly seekMs: number }
  | { readonly type: "SET_IS_PLAYING"; readonly isPlaying: boolean };

export function createInitialPlaygroundState(options?: {
  readonly templateId?: string;
  readonly sizePreset?: SizePresetId;
  readonly theme?: string;
}): PlaygroundDesignState {
  const targetId = options?.templateId ?? "quote-card";
  let details: { manifest: TemplateManifest; defaultSample: Record<string, unknown> };
  try {
    details = getTemplateDetails(targetId);
  } catch {
    details = getTemplateDetails("quote-card");
  }

  const { manifest, defaultSample } = details;
  const sizePreset =
    options?.sizePreset && manifest.supportedSizes.includes(options.sizePreset)
      ? options.sizePreset
      : manifest.defaultSize;
  const theme =
    options?.theme && manifest.themes[options.theme] ? options.theme : manifest.defaultTheme;
  const durationMs = manifest.kind === "video" ? (manifest.durationMs ?? 4000) : 0;

  return {
    templateId: manifest.id,
    manifest,
    sizeMode: "preset",
    sizePreset,
    customDimensions: { width: 1080, height: 1080 },
    theme,
    tokenOverrides: {},
    slotData: structuredClone(defaultSample),
    activeSlideIndex: 1,
    showSafeZone: false,
    seekMs: manifest.kind === "video" ? Math.round(durationMs * 0.85) : 0,
    isPlaying: false,
    revision: 1,
  };
}

export function playgroundStateReducer(
  state: PlaygroundDesignState,
  action: PlaygroundAction,
): PlaygroundDesignState {
  switch (action.type) {
    case "SELECT_TEMPLATE": {
      return {
        ...createInitialPlaygroundState({
          templateId: action.templateId,
          sizePreset: action.sizePreset ?? state.sizePreset,
          theme: action.theme ?? state.theme,
        }),
        showSafeZone: state.showSafeZone,
        revision: state.revision + 1,
      };
    }

    case "SET_SIZE_PRESET": {
      return {
        ...state,
        sizeMode: "preset",
        sizePreset: action.sizePreset,
        revision: state.revision + 1,
      };
    }

    case "SET_CUSTOM_DIMENSIONS": {
      const clampedWidth = Math.max(320, Math.min(3840, Math.round(action.width || 1080)));
      const clampedHeight = Math.max(320, Math.min(3840, Math.round(action.height || 1080)));
      return {
        ...state,
        sizeMode: "custom",
        customDimensions: { width: clampedWidth, height: clampedHeight },
        revision: state.revision + 1,
      };
    }

    case "SET_THEME": {
      if (!state.manifest.themes[action.theme]) {
        return state;
      }
      return {
        ...state,
        theme: action.theme,
        tokenOverrides: {},
        revision: state.revision + 1,
      };
    }

    case "SET_TOKEN_OVERRIDE": {
      return {
        ...state,
        tokenOverrides: {
          ...state.tokenOverrides,
          [action.token]: action.value,
        },
        revision: state.revision + 1,
      };
    }

    case "RESET_TOKEN_OVERRIDES": {
      return {
        ...state,
        tokenOverrides: {},
        revision: state.revision + 1,
      };
    }

    case "UPDATE_SLOT_VALUE": {
      return {
        ...state,
        slotData: {
          ...state.slotData,
          [action.slotName]: action.value,
        },
        revision: state.revision + 1,
      };
    }

    case "REPLACE_SLOT_DATA": {
      return {
        ...state,
        slotData: structuredClone(action.data),
        activeSlideIndex: 1,
        revision: state.revision + 1,
      };
    }

    case "RESET_SLOTS_TO_SAMPLE": {
      const { defaultSample } = getTemplateDetails(state.templateId);
      return {
        ...state,
        slotData: structuredClone(defaultSample),
        activeSlideIndex: 1,
        revision: state.revision + 1,
      };
    }

    case "SET_ACTIVE_SLIDE": {
      return {
        ...state,
        activeSlideIndex: Math.max(1, action.slideIndex),
        revision: state.revision + 1,
      };
    }

    case "TOGGLE_SAFE_ZONE": {
      return {
        ...state,
        showSafeZone: action.enabled ?? !state.showSafeZone,
      };
    }

    case "SET_SEEK_MS": {
      const maxDuration = state.manifest.kind === "video" ? (state.manifest.durationMs ?? 4000) : 0;
      const clampedSeek = Math.max(0, Math.min(maxDuration, Math.round(action.seekMs)));
      return {
        ...state,
        seekMs: clampedSeek,
      };
    }

    case "SET_IS_PLAYING": {
      return {
        ...state,
        isPlaying: action.isPlaying,
      };
    }
  }
}
