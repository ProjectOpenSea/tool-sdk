export class ToolHandlerError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    if (status < 100 || status > 599) {
      throw new RangeError(
        `ToolHandlerError: status must be 100–599, got ${status}`,
      )
    }
    super(message)
    this.name = "ToolHandlerError"
    this.status = status
  }
}
