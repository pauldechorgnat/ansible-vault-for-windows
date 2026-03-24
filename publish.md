# Publishing to the VS Code Extension Marketplace

## Step 1 — Create a publisher identity

1. Go to **https://marketplace.visualstudio.com/manage**
2. Sign in with a **Microsoft account** (create a free one if needed — the same account used for Outlook, GitHub, Xbox, etc.)
3. Click **Create publisher**, pick a publisher ID (e.g. `paulsmith` or your org name)
4. That ID becomes your `publisher` field — **update it in `package.json`** to match exactly:

```json
"publisher": "your-chosen-id",
```

## Step 2 — Create a Personal Access Token

1. Go to **https://dev.azure.com** → sign in with the same Microsoft account
2. Top-right → **User settings** → **Personal access tokens** → **New Token**
3. Set:
   - **Organization**: All accessible organizations
   - **Scopes**: Custom → check **Marketplace → Manage**
   - **Expiration**: up to 1 year
4. Copy the token — you will only see it once

## Step 3 — Fix the placeholders in `package.json`

The current `repository.url` is a placeholder. Either point it at a real GitHub repo, or remove the `repository` block entirely before publishing (the marketplace will reject a broken URL).

Also double-check `publisher` matches what you created in Step 1.

## Step 4 — Install the packaging tool and log in

```bash
cd ansible-vault-for-windows
npm install --save-dev @vscode/vsce
npx vsce login your-chosen-id   # paste the PAT when prompted
```

## Step 5 — Dry run: package locally

```bash
npx vsce package
```

This produces `ansible-vault-for-windows-0.1.0.vsix`. Install it yourself to do a final smoke test:

```bash
code --install-extension ansible-vault-for-windows-0.1.0.vsix
```

## Step 6 — Publish

```bash
npx vsce publish
```

The extension appears on the marketplace within a few minutes at:
`https://marketplace.visualstudio.com/items?itemName=your-chosen-id.ansible-vault-for-windows`

---

## Improving discoverability (optional but worth doing)

| What | How |
|---|---|
| **Icon** | Add a 128×128 PNG and set `"icon": "images/icon.png"` in `package.json` |
| **Gallery banner** | Add `"galleryBanner": { "color": "#1e1e1e", "theme": "dark" }` in `package.json` |
| **Categories** | Change `"Other"` to `"Formatters"` or keep both |
| **README badges** | Add a VS Code Marketplace badge at the top of the README |

---

## Releasing a new version later

```bash
npx vsce publish patch   # 0.1.0 → 0.1.1
npx vsce publish minor   # 0.1.0 → 0.2.0
npx vsce publish major   # 0.1.0 → 1.0.0
```
