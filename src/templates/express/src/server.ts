import { createWellKnownHandler, toExpressHandler } from "@opensea/tool-sdk"
import express from "express"
import { toolHandler } from "./handler.js"
import { manifest } from "./manifest.js"

const app = express()
app.use(express.json())

const wellKnownHandler = createWellKnownHandler(manifest)

app.post("/api", toExpressHandler(toolHandler))
app.get("/.well-known/ai-tool/:slug", toExpressHandler(wellKnownHandler))

const port = process.env.PORT ?? 3000
app.listen(port, () => {
  console.log(`Tool server running on port ${port}`)
})
