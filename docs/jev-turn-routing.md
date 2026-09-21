# Jev turn routing

T3 can optionally ask TypeSafe Jev for a model tier before dispatching a
`thread.turn.start` command. Routing is disabled by default and always fails
open to the model selected in the composer.

The server sends the first 12,000 characters of the user request, the current
provider/model, and the interaction mode. API keys stay server-side and are
never included in activities or request bodies.

## Configuration

| Environment variable              | Default                      | Purpose                            |
| --------------------------------- | ---------------------------- | ---------------------------------- |
| `T3CODE_JEV_MODE`                 | `off`                        | `off`, `shadow`, or `apply`        |
| `T3CODE_JEV_API_KEY`              | unset                        | TypeSafe API key                   |
| `T3CODE_JEV_API_URL`              | TypeSafe System One endpoint | API override                       |
| `T3CODE_JEV_TIMEOUT_MS`           | `1500`                       | Fail-open request timeout          |
| `T3CODE_JEV_CONFIDENCE_THRESHOLD` | `0.8`                        | Minimum confidence in `apply` mode |
| `T3CODE_JEV_MODEL_SMALL`          | unset                        | Model slug for the `small` tier    |
| `T3CODE_JEV_MODEL_NORMAL`         | unset                        | Model slug for the `normal` tier   |
| `T3CODE_JEV_MODEL_EXPERT`         | unset                        | Model slug for the `expert` tier   |

Start with `shadow`. Each routed turn gets a `jev.turn-routing` activity with
the recommendation, confidence, latency, token usage, and chosen mapping.
The selected model is unchanged. In `apply`, T3 changes only the current turn
when the tier has a configured model and confidence meets the threshold.

Example:

```bash
T3CODE_JEV_MODE=shadow \
T3CODE_JEV_API_KEY="$TYPESAFE_API_KEY" \
T3CODE_JEV_MODEL_SMALL=gpt-5.6-luna \
T3CODE_JEV_MODEL_NORMAL=gpt-5.6-terra \
T3CODE_JEV_MODEL_EXPERT=gpt-5.6-sol \
bun run --cwd apps/server dev
```

Use a service manager or secret store for production configuration. Do not put
the API key in a repository, command-line argument, or browser-side setting.
