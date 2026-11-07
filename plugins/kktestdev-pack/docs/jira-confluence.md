# Jira / Confluence: connect with your own account

The pack does **not** install an Atlassian server. Everyone signs in as themselves, and on our
setup that means your own LDAP account. Pick the section that matches where Jira lives.

> Before adding one, run `/kk-onboard` or `claude mcp list` and look for `atlassian`. It may
> already be there from a claude.ai connector or a synced plugin. A second copy is a second
> login, not a second feature.

## A. Jira / Confluence **Server or Data Center** (self-hosted, LDAP login)

Use the community server [`sooperset/mcp-atlassian`](https://github.com/sooperset/mcp-atlassian)
(MIT, supports Server/DC with a Personal Access Token or basic auth). It runs with `uvx`, so you
need [uv](https://docs.astral.sh/uv/) installed.

1. Create a **Personal Access Token** in Jira (Profile → Personal Access Tokens) and another in
   Confluence. PATs are available on Server/DC 8.14+ (Jira) and 7.9+ (Confluence). If PATs are off
   on our instance, use your LDAP username + password (basic auth) instead.
2. Put the secrets in your shell profile or keychain, **not** in the MCP config:

   ```sh
   export JIRA_URL="https://jira.example.internal"
   export JIRA_PERSONAL_TOKEN="..."          # or JIRA_USERNAME + JIRA_API_TOKEN (=password) for basic auth
   export CONFLUENCE_URL="https://confluence.example.internal"
   export CONFLUENCE_PERSONAL_TOKEN="..."
   ```

3. Add the server so it inherits those variables:

   ```sh
   claude mcp add --scope user atlassian -- uvx mcp-atlassian
   ```

4. Restart your terminal (so the exports are loaded), start `claude`, and check `/mcp`.

Check the variable names against the project README before you rely on them. They have changed
between releases. If our instance uses a private CA, see the README's SSL options
(`JIRA_SSL_VERIFY`).

## B. Atlassian **Cloud** (`*.atlassian.net`)

Use Atlassian's official remote server (Rovo MCP, OAuth 2.1; Atlassian says it may require a Rovo
licence on the site):

```sh
claude mcp add --transport http --scope user atlassian https://mcp.atlassian.com/v1/mcp
```

Then run `/mcp` → `atlassian` → authenticate in the browser. If you use claude.ai, connecting
"Atlassian" under claude.ai Settings → Connectors gives you the same server without this step.
