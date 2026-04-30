import { z } from "zod/v4"

export const PricingEntrySchema = z.object({
  amount: z.string(),
  asset: z.string(),
  recipient: z.string(),
  protocol: z.string(),
})

export const ToolManifestSchema = z.object({
  type: z
    .string()
    .default(
      "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
    ),
  name: z.string().min(1).max(128),
  description: z.string().min(1).max(500),
  version: z.string().optional(),
  endpoint: z
    .string()
    .url()
    .refine(
      u => u.startsWith("https://"),
      "endpoint must use https",
    ),
  image: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
  inputs: z.record(z.string(), z.unknown()),
  outputs: z.record(z.string(), z.unknown()),
  creatorAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "must be EVM address"),
  pricing: z.array(PricingEntrySchema).optional(),
})
