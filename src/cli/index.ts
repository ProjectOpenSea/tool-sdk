import { Command } from "commander"
import { authCommand } from "./commands/auth.js"
import { configureERC20GateCommand } from "./commands/configure-erc20-gate.js"
import { configureSubscriptionCommand } from "./commands/configure-subscription.js"
import { configureTraitGatingCommand } from "./commands/configure-trait-gating.js"
import { deployCommand } from "./commands/deploy.js"
import { dryRunGateCommand } from "./commands/dry-run-gate.js"
import { dryRunPredicateGateCommand } from "./commands/dry-run-predicate-gate.js"
import { exportCommand } from "./commands/export.js"
import { getCollectionsCommand } from "./commands/get-collections.js"
import { getERC20ConfigCommand } from "./commands/get-erc20-config.js"
import { getTraitConfigCommand } from "./commands/get-trait-config.js"
import { hashCommand } from "./commands/hash.js"
import { initCommand } from "./commands/init.js"
import { inspectCommand } from "./commands/inspect.js"
import { payCommand } from "./commands/pay.js"
import { registerCommand } from "./commands/register.js"
import { setCollectionTokensCommand } from "./commands/set-collection-tokens.js"
import { setCollectionsCommand } from "./commands/set-collections.js"
import { smokeCommand } from "./commands/smoke.js"
import { updateMetadataCommand } from "./commands/update-metadata.js"
import { validateCommand } from "./commands/validate.js"
import { verifyCommand } from "./commands/verify.js"

declare const __VERSION__: string

export const program = new Command()
  .name("tool-sdk")
  .description("SDK and CLI for building ERC-8257 compliant AI agent tools")
  .version(__VERSION__)

program.addCommand(authCommand)
program.addCommand(initCommand)
program.addCommand(validateCommand)
program.addCommand(hashCommand)
program.addCommand(exportCommand)
program.addCommand(verifyCommand)
program.addCommand(registerCommand)
program.addCommand(deployCommand)
program.addCommand(updateMetadataCommand)
program.addCommand(payCommand)
program.addCommand(dryRunGateCommand)
program.addCommand(dryRunPredicateGateCommand)
program.addCommand(inspectCommand)
program.addCommand(smokeCommand)
program.addCommand(setCollectionsCommand)
program.addCommand(getCollectionsCommand)
program.addCommand(setCollectionTokensCommand)
program.addCommand(configureSubscriptionCommand)
program.addCommand(configureTraitGatingCommand)
program.addCommand(getTraitConfigCommand)
program.addCommand(configureERC20GateCommand)
program.addCommand(getERC20ConfigCommand)
