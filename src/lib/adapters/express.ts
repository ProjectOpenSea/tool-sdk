type WebHandler = (request: Request) => Response | Promise<Response>

export interface ExpressRequest {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  hostname: string
  protocol: string
  body?: unknown
  [key: string]: unknown
}

export interface ExpressResponse {
  status(code: number): ExpressResponse
  set(name: string, value: string): ExpressResponse
  json(body: unknown): void
  send(body: string | Buffer): void
  end(): void
  [key: string]: unknown
}

export function toExpressHandler(
  handler: WebHandler,
): (req: ExpressRequest, res: ExpressResponse) => void {
  return (req, res) => {
    const protocol = req.protocol ?? "https"
    const host = (req.headers.host as string) ?? req.hostname
    const url = `${protocol}://${host}${req.url}`

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
      body: hasBody ? JSON.stringify(req.body) : undefined,
    })

    Promise.resolve(handler(webRequest))
      .then(async webResponse => {
        res.status(webResponse.status)
        webResponse.headers.forEach((value, key) => {
          res.set(key, value)
        })
        const body = await webResponse.text()
        res.send(body)
      })
      .catch(() => {
        res.status(500).json({ error: "Internal tool error" })
      })
  }
}
