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

### Step 1 — Run the tests

```bash
node test/cryptoTest.js
```

All tests must pass before publishing.

### Step 2 — Bump the version

Edit `package.json` and increment `"version"` following semver, **or** let `vsce` do it automatically in the next step.

Keep both in sync: if you bump manually, use the same number in the `vsce publish` command.

### Step 3 — Rebuild and package locally for a smoke test

```bash
npx vsce package
code --install-extension ansible-vault-for-windows-<version>.vsix
```

Open a real vault file in VS Code and verify encrypt/decrypt works end-to-end.

### Step 4 — Publish

```bash
# Bump patch (0.2.0 → 0.2.1), minor (→ 0.3.0) or major (→ 1.0.0):
npx vsce publish patch
npx vsce publish minor
npx vsce publish major

# Or publish exactly the version already written in package.json:
npx vsce publish
```

`vsce publish <increment>` automatically updates `package.json` and creates a git tag. If you bumped the version manually in Step 2, use `npx vsce publish` (no increment argument) to avoid a double-bump.

The updated extension appears on the marketplace within a few minutes at:
`https://marketplace.visualstudio.com/items?itemName=pauldechorgnat.ansible-vault-for-windows`
