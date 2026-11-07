# Figma: connect your own account

The pack does not install Figma, because each person signs in with their own Figma account.
Choose **one** of these. Using two gives you two copies of the same server and two logins.

- **claude.ai connector**: claude.ai → Settings → Connectors → Figma → Connect. It shows up in
  Claude Code as `claude.ai Figma` automatically.
- **Plugin** (Claude Code only): `claude plugin install figma@claude-plugins-official`, then
  `/mcp` → `figma` → authenticate.

Check first with `claude mcp list | grep -i figma` (PowerShell: `claude mcp list | Select-String -SimpleMatch figma`).
It may already be there from a synced plugin.
