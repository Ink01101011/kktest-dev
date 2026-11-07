# Jira / Confluence: connect with your own account

The pack does **not** install an Atlassian server. Everyone signs in as themselves, and on our
setup that means your own LDAP account. Pick the section that matches where Jira lives.

> Before adding one, run `/kk-onboard` or `claude mcp list` and look for `atlassian`. It may
> already be there from a claude.ai connector or a synced plugin. A second copy is a second
> login, not a second feature.

## A. Jira / Confluence **Server or Data Center** (self-hosted, LDAP login)

Use the community server [`sooperset/mcp-atlassian`](https://github.com/sooperset/mcp-atlassian)
(MIT, supports Server/DC with a Personal Access Token or basic auth). It runs with `uvx`, so you
need [uv](https://docs.astral.sh/uv/) installed (macOS: `brew install uv`; Windows:
`winget install astral-sh.uv`; any OS: see the uv docs). It is a third-party package that runs
with your token: check the repository before you use it. It is the **PyPI** package; the npm
package named `mcp-atlassian` is a different project, so do not run it with `npx`.

1. Create a **Personal Access Token** in Jira (Profile → Personal Access Tokens) and another in
   Confluence. PATs are available on Server/DC 8.14+ (Jira) and 7.9+ (Confluence). Prefer a PAT:
   it can be revoked on its own. Only if PATs are off on our instance, use basic auth, and then
   never store your LDAP password in a shell profile or dotfile (it is your domain login).
2. Store the tokens in your OS credential store and load them into the environment when the
   shell starts. Keep them out of the MCP config.

   **macOS (Keychain)**: store once, then read in `~/.zshrc`:

   ```sh
   security add-generic-password -a "$USER" -s jira-pat -w        # prompts for the token
   security add-generic-password -a "$USER" -s confluence-pat -w
   # in ~/.zshrc:
   export JIRA_URL="https://jira.example.internal"
   export JIRA_PERSONAL_TOKEN="$(security find-generic-password -a "$USER" -s jira-pat -w)"
   export CONFLUENCE_URL="https://confluence.example.internal"
   export CONFLUENCE_PERSONAL_TOKEN="$(security find-generic-password -a "$USER" -s confluence-pat -w)"
   ```

   **Linux (libsecret)**: `secret-tool store --label=jira-pat service jira-pat` once, then
   `export JIRA_PERSONAL_TOKEN="$(secret-tool lookup service jira-pat)"` in your profile. A
   password manager CLI (1Password `op read`, `pass`) works the same way.

   **Windows (PowerShell)**: store once with the SecretManagement module
   (`Install-Module Microsoft.PowerShell.SecretManagement, Microsoft.PowerShell.SecretStore`,
   then `Set-Secret jira-pat`), and in your `$PROFILE`:

   ```powershell
   $env:JIRA_URL = "https://jira.example.internal"
   $env:JIRA_PERSONAL_TOKEN = Get-Secret jira-pat -AsPlainText
   $env:CONFLUENCE_URL = "https://confluence.example.internal"
   $env:CONFLUENCE_PERSONAL_TOKEN = Get-Secret confluence-pat -AsPlainText
   ```

   **Fallback, plain text** (only if none of the above is available): `export JIRA_PERSONAL_TOKEN="..."`
   in your shell profile (PowerShell: `setx JIRA_PERSONAL_TOKEN "..."`, new sessions only). Know
   the cost: the token sits unencrypted in a dotfile that backups and dotfile repos copy, and
   every process you start (including all other MCP servers and hooks) inherits it. Make the
   file readable only by you (`chmod 600 ~/.zshrc`) and never commit it.

3. Add the server so it inherits those variables:

   ```sh
   claude mcp add --scope user atlassian -- uvx mcp-atlassian
   ```

4. Open a new terminal (so the variables are loaded), start `claude` from it, and check `/mcp`.
   An IDE started from the Dock / Start menu does not read shell profiles: start it from that
   terminal, or set the variables where the IDE reads them.

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
