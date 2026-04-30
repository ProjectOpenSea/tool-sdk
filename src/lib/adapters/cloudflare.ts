type WebHandler = (request: Request) => Promise<Response>

export function toCloudflareHandler(handler: WebHandler): {
  fetch: (request: Request) => Promise<Response>
} {
  return {
    fetch: handler,
  }
}
