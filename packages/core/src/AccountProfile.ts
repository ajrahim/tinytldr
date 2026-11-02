import { z } from "zod";

export const ACCOUNT_DISPLAY_NAME_MAX_LENGTH = 80;

export const AccountProfileInputSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .max(ACCOUNT_DISPLAY_NAME_MAX_LENGTH, "Use 80 characters or fewer for your display name."),
  })
  .strict();
