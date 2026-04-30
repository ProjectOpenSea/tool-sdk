import { Command } from "commander"
import { authCommand } from "./commands/auth.js"
import { deployCommand } from "./commands/deploy.js"
import { dryRunGateCommand } from "./commands/dry-run-gate.js"
import { dryRunPredicateGateCommand } from "./commands/dry-run-predicate-gate.js"
import { exportCommand } from "./commands/export.js"
import { hashCommand } from "./commands/hash.js"
import { initCommand } from "./commands/init.js"
import { inspectCommand } from "./commands/inspect.js"
import { payCommand } from "./commands/pay.js"
import { registerCommand } from "./commands/register.js"
import { updateMetadataCommand } from "./commands/update-metadata.js"
import { validateCommand } from "./commands/validate.js"
import { verifyCommand } from "./commands/verify.js"

declare const __VERSION__: string

export const program = new Command()
  .name("tool-sdk")
  .description("SDK and CLI for building ERC-XXXX compliant AI agent tools")
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
