# LLM Provider Boundary (Phase 11I)

How the gateway chooses a provider, and the hard network gate.

## Configuration (environment)

| Variable | Meaning | Default |
| --- | --- | --- |
| `HARTOS_LLM_PROVIDER` | `openai` or `deterministic` | `deterministic` |
| `HARTOS_LLM_ENABLE_NETWORK` | Hard gate for any network call | unset (off) |
| `OPENAI_API_KEY` | OpenAI key (presence only is ever reported) | unset |
| `HARTOS_LLM_MODEL` | Model id | `gpt-4o-mini` |

## Selection rule

OpenAI runs **only** when all three are true:

1. `HARTOS_LLM_PROVIDER=openai`, **and**
2. `HARTOS_LLM_ENABLE_NETWORK=true`, **and**
3. `OPENAI_API_KEY` is present.

Otherwise the gateway uses the deterministic provider.

> **Hard rule:** If `HARTOS_LLM_ENABLE_NETWORK` is not `true`, OpenAI is never
> called — even if `OPENAI_API_KEY` exists.

- **OpenAI is gated by explicit env.** Defense in depth: the OpenAI adapter also
  refuses to reach the network unless the gate is on.
- The resolved config reports `apiKeyPresent` (boolean) only — never the key.
- **Tests use the deterministic provider or a mocked provider only.** No network
  call occurs in the test suite.

Check the resolved configuration any time with:

```
npm run llm:status
```
