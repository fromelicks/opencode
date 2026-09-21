import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { parse } from "jsonc-parser"
import { mkdir } from "node:fs/promises"
import path from "path"
import { cliIt } from "../lib/cli-process"

describe("opencode mcp add (non-interactive subprocess)", () => {
  cliIt.concurrent(
    "adds a remote server with HTTP headers",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.spawn([
          "mcp",
          "add",
          "github",
          "--url",
          "https://example.com/mcp",
          "--header",
          "Authorization=Bearer {env:GITHUB_TOKEN}",
          "--header",
          "X-Option=one=two",
        ])
        opencode.expectExit(result, 0)

        const config = yield* Effect.promise(() =>
          Bun.file(path.join(home, ".config", "opencode", "opencode.jsonc")).json(),
        )
        expect(config.$schema).toBe("https://opencode.ai/config.json")
        expect(config.mcp.github).toEqual({
          type: "remote",
          url: "https://example.com/mcp",
          headers: {
            Authorization: "Bearer {env:GITHUB_TOKEN}",
            "X-Option": "one=two",
          },
        })
      }),
    60_000,
  )

  cliIt.concurrent(
    "adds a local server while preserving argv and environment values",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.spawn([
          "mcp",
          "add",
          "local",
          "--env",
          "API_KEY=secret",
          "--env",
          "VALUE=one=two",
          "--",
          "npx",
          "-y",
          "@example/server",
          "--label",
          "two words",
        ])
        opencode.expectExit(result, 0)

        const config = yield* Effect.promise(() =>
          Bun.file(path.join(home, ".config", "opencode", "opencode.jsonc")).json(),
        )
        expect(config.mcp.local).toEqual({
          type: "local",
          command: ["npx", "-y", "@example/server", "--label", "two words"],
          environment: {
            API_KEY: "secret",
            VALUE: "one=two",
          },
        })
      }),
    60_000,
  )

  cliIt.concurrent(
    "sets remote OAuth, enabled, and timeout options while preserving JSONC comments",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const configPath = path.join(home, ".config", "opencode", "opencode.jsonc")
        yield* Effect.promise(() => mkdir(path.dirname(configPath), { recursive: true }))
        yield* Effect.promise(() =>
          Bun.write(
            configPath,
            `{
  // Keep this user setting.
  "model": "provider/model",
  "mcp": {
    // Keep this other server.
    "other": {
      "type": "remote",
      "url": "https://example.com/mcp"
    }
  }
}
`,
          ),
        )

        const result = yield* opencode.spawn([
          "mcp",
          "add",
          "catalog",
          "--url",
          "https://example.com/catalog",
          "--oauth=false",
          "--enabled=true",
          "--timeout",
          "120000",
          "--config",
          configPath,
        ])
        opencode.expectExit(result, 0)

        const text = yield* Effect.promise(() => Bun.file(configPath).text())
        expect(text).toContain("// Keep this user setting.")
        expect(text).toContain("// Keep this other server.")
        const config = parse(text)
        expect(config.model).toBe("provider/model")
        expect(config.mcp.other).toEqual({
          type: "remote",
          url: "https://example.com/mcp",
        })
        expect(config.mcp.catalog).toEqual({
          type: "remote",
          url: "https://example.com/catalog",
          oauth: false,
          enabled: true,
          timeout: 120000,
        })
      }),
    60_000,
  )

  cliIt.concurrent(
    "skips a remote server when its URL is already configured under another name",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const configPath = path.join(home, ".config", "opencode", "opencode.jsonc")
        const original = `{
  "$schema": "https://opencode.ai/config.json",
  // Preserve the existing server exactly.
  "mcp": {
    "existing": {
      "type": "remote",
      "url": "https://example.com/catalog",
      "enabled": false
    }
  }
}
`
        yield* Effect.promise(() => mkdir(path.dirname(configPath), { recursive: true }))
        yield* Effect.promise(() => Bun.write(configPath, original))

        const result = yield* opencode.spawn([
          "mcp",
          "add",
          "catalog",
          "--url",
          "https://example.com/catalog",
          "--oauth=false",
          "--enabled=true",
          "--timeout",
          "120000",
          "--config",
          configPath,
          "--skip-existing-url",
        ])
        opencode.expectExit(result, 0)
        expect(yield* Effect.promise(() => Bun.file(configPath).text())).toBe(original)
      }),
    60_000,
  )

  cliIt.concurrent(
    "checks the resolved global config when writing to an explicit file",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const existingPath = path.join(home, ".config", "opencode", "opencode.json")
        const targetPath = path.join(home, ".config", "opencode", "opencode.jsonc")
        yield* Effect.promise(() => mkdir(path.dirname(existingPath), { recursive: true }))
        yield* Effect.promise(() =>
          Bun.write(
            existingPath,
            JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              mcp: {
                existing: {
                  type: "remote",
                  url: "https://example.com/catalog",
                },
              },
            }),
          ),
        )

        const result = yield* opencode.spawn([
          "mcp",
          "add",
          "catalog",
          "--url",
          "https://example.com/catalog",
          "--config",
          targetPath,
          "--skip-existing-url",
        ])
        opencode.expectExit(result, 0)
        expect(yield* Effect.promise(() => Bun.file(targetPath).exists())).toBe(false)
      }),
    60_000,
  )

  cliIt.concurrent(
    "leaves an invalid JSONC config unchanged",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const configPath = path.join(home, ".config", "opencode", "opencode.jsonc")
        const original = `{
  "mcp": {
}
`
        yield* Effect.promise(() => mkdir(path.dirname(configPath), { recursive: true }))
        yield* Effect.promise(() => Bun.write(configPath, original))

        const result = yield* opencode.spawn([
          "mcp",
          "add",
          "example",
          "--url",
          "https://example.com/mcp",
          "--config",
          configPath,
        ])
        expect(result.exitCode).not.toBe(0)
        expect(yield* Effect.promise(() => Bun.file(configPath).text())).toBe(original)
      }),
    60_000,
  )
})
