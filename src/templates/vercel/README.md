# {{TOOL_NAME}}

An ERC-XXXX compliant AI agent tool deployed on Vercel.

## Setup

```bash
npm install
```

## Development

```bash
npx vercel dev
```

## Deploy

```bash
npx vercel
```

## Register onchain

```bash
npx @opensea/tool-sdk verify {{TOOL_ENDPOINT}}/.well-known/ai-tool/{{TOOL_SLUG}}.json
npx @opensea/tool-sdk register --metadata {{TOOL_ENDPOINT}}/.well-known/ai-tool/{{TOOL_SLUG}}.json --network base
```
