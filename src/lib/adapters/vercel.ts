type WebHandler = (request: Request) => Response | Promise<Response>

export interface VercelRequest {
  method: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
  rawBody?: Buffer
  [key: string]: unknown
}

export interface VercelResponse {
  status(code: number): VercelResponse
  setHeader(name: string, value: string): VercelResponse
  json(body: unknown): void
  send(body: string | Buffer): void
  end(): void
  [key: string]: unknown
}

export function toVercelHandler(
  handler: WebHandler,
): (req: VercelRequest, res: VercelResponse) => Promise<void> {
  return async (req, res) => {
    const protocol = "https"
    const host =
      (req.headers.host as string | undefined) ?? "localhost"
    const url = `${protocol}://${host}${req.url ?? "/"}`

    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        headers.set(
          key,
          Array.isArray(value) ? value.join(", ") : value,
        )
      }
    }

    const hasBody =
      req.method !== "GET" && req.method !== "HEAD"
    const webRequest = new Request(url, {
      method: req.method,
      headers,
      body: hasBody
        ? JSON.stringify(req.body)
        : undefined,
    })

    const webResponse = await handler(webRequest)

    res.status(webResponse.status)
    webResponse.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })

    const body = await webResponse.text()
    res.send(body)
  }
}
