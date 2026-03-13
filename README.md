# T3 Code

T3 Code is a minimal web GUI for coding agents. Currently Codex-first, with Claude Code support coming soon.

## How to use

> [!WARNING]
> You need to have [Codex CLI](https://github.com/openai/codex) installed and authorized for T3 Code to work.

```bash
npx t3
```

You can also just install the desktop app. It's cooler.

Install the [desktop app from the Releases page](https://github.com/pingdotgg/t3code/releases)

## Jira Integration (optional)

T3 Code can link chat sessions to Jira tickets — create, link, unlink, post AI-generated progress comments, and transition ticket status directly from the UI.

To enable it, set the following environment variables:

```bash
# Your Jira Cloud instance URL
JIRA_BASE_URL=https://yourcompany.atlassian.net

# Your Jira account email
JIRA_USER_EMAIL=you@company.com

# A Jira API token (https://id.atlassian.com/manage-profile/security/api-tokens)
JIRA_API_TOKEN=your-api-token
```

When all three are set, a Jira button appears in the chat toolbar. When unset, the Jira UI is completely hidden.

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

## If you REALLY want to contribute still.... read this first

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
