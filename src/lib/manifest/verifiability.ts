import type { Attestation, ReproducibleBuild, Verifiability } from "./types.js"
import { VerifiabilitySchema } from "./schema.js"

type DataRetention = NonNullable<Verifiability["dataRetention"]>
type SourceVisibility = NonNullable<Verifiability["sourceVisibility"]>
// Subset of execution enforced by superRefine for hardware-attested/verifiable tiers
type TeeExecution = "tee" | "e2ee"

interface VerifiabilityCommon {
  description?: string
  dataRetention?: DataRetention
  sourceVisibility?: SourceVisibility
}

export type SelfAttestedConfig = VerifiabilityCommon

export interface HardwareAttestedConfig extends VerifiabilityCommon {
  execution: TeeExecution
  attestation: Attestation
}

export interface VerifiableConfig extends VerifiabilityCommon {
  execution: TeeExecution
  attestation: Attestation
  reproducibleBuild: ReproducibleBuild
}

function validate(raw: Record<string, unknown>): Verifiability {
  const result = VerifiabilitySchema.safeParse(raw)
  if (!result.success) {
    const msgs = result.error.issues
      .map(i => `${i.path.join(".")}: ${i.message}`)
      .join("; ")
    throw new Error(
      `[tool-sdk] defineVerifiability: invalid config: ${msgs}`,
    )
  }
  return result.data
}

function selfAttested(
  config: SelfAttestedConfig = {},
): { verifiability: Verifiability } {
  const verifiability = validate({
    ...config,
    tier: "self-attested",
    execution: "standard",
  })
  return { verifiability }
}

function hardwareAttested(
  config: HardwareAttestedConfig,
): { verifiability: Verifiability } {
  const verifiability = validate({
    ...config,
    tier: "hardware-attested",
  })
  return { verifiability }
}

function verifiable(
  config: VerifiableConfig,
): { verifiability: Verifiability } {
  const verifiability = validate({
    ...config,
    tier: "verifiable",
  })
  return { verifiability }
}

export const defineVerifiability = {
  selfAttested,
  hardwareAttested,
  verifiable,
} as const
