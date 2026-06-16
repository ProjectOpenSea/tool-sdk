import { describe, expect, it } from "vitest"
import {
  type PaymentRequirements,
  validatePaymentRequirements,
} from "../lib/client/x402-payment.js"

const base: PaymentRequirements = {
  scheme: "exact",
  network: "base",
  maxAmountRequired: "1000000",
  payTo: "0x1111111111111111111111111111111111111111",
  // USDC on Base; validatePaymentRequirements rejects any other asset when
  // allowedAssets is not provided.
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
}

describe("validatePaymentRequirements", () => {
  it("passes for a well-formed requirement", () => {
    expect(() => validatePaymentRequirements(base, {})).not.toThrow()
  })

  it("rejects a burn/zero payTo address", () => {
    expect(() =>
      validatePaymentRequirements(
        { ...base, payTo: "0x0000000000000000000000000000000000000000" },
        {},
      ),
    ).toThrow(/burn\/zero address/)
  })

  it("rejects when the server amount exceeds maxAmount", () => {
    expect(() =>
      validatePaymentRequirements(base, { maxAmount: "999999" }),
    ).toThrow(/maxAmount/)
  })

  it("passes when the server amount is within maxAmount", () => {
    expect(() =>
      validatePaymentRequirements(base, { maxAmount: "1000000" }),
    ).not.toThrow()
  })
})
