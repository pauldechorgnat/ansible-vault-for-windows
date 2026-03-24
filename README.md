# Ansible Vault for Windows

A VS Code extension to read, edit, and create [Ansible Vault](https://docs.ansible.com/ansible/latest/vault_guide/index.html) files — **without Python, without the `ansible` CLI, and without any npm dependencies**.

Built for people who work on locked-down Windows machines where installing Python packages or dev tools isn't an option.

---

## Why this exists

Standard Ansible Vault plugins rely on the `ansible-vault` Python CLI or the `ansible` Python library. On heavily managed corporate Windows machines those are often unavailable. This extension uses only Node.js's built-in `crypto` module (AES-256-CTR + PBKDF2-SHA256), which is bundled with VS Code itself — nothing to install.

---

## Features

| Feature | Description |
|---|---|
| **Transparent editing** | Open any vault file decrypted, edit it, save — the file on disk is always re-encrypted. The plaintext never touches the filesystem. |
| **Read-only preview** | Quickly peek at a vault's content without entering an editable mode. |
| **Encrypt existing file** | Turn any plain-text file into an Ansible vault in-place. |
| **Create new vault** | Create a fresh encrypted file and immediately open it for editing. |
| **Re-key** | Change the password of a vault without leaving VS Code. |
| **Vault ID support** | Read and write both `1.1` (no ID) and `1.2` (with vault ID) formats. |
| **Password caching** | Choose between never caching, session-only (default), or persistent keychain storage. |
| **Status bar** | Always shows whether the active file is encrypted, in decrypted-view, or dangerously unencrypted. |
| **File decorations** | 🔒 / 🔓 icons in the Explorer tree. |
| **Workspace scanner** | Finds every file matching vault-name patterns that is NOT encrypted. |
| **Git pre-commit hook** | Installs a shell script that blocks commits of unencrypted vault-pattern files. Works with Git Bash on Windows. |

---

## Installation

### From source (development)

```bash
git clone https://github.com/your-org/ansible-vault-for-windows
cd ansible-vault-for-windows
code .
```

Press `F5` to open an **Extension Development Host** window with the extension loaded.

### Package as `.vsix`

```bash
npm install --save-dev @vscode/vsce
npx vsce package
```

This produces `ansible-vault-for-windows-0.1.0.vsix`. Install it in VS Code:

- **UI**: Extensions → `⋯` menu → *Install from VSIX…*
- **Command line**: `code --install-extension ansible-vault-for-windows-0.1.0.vsix`

> **No runtime npm dependencies.** The `@vscode/vsce` package above is only needed to build the `.vsix` file, not to run the extension.

---

## Usage

### Opening a vault file

When you open any file that begins with `$ANSIBLE_VAULT`, a notification appears:

```
Ansible Vault: "secrets.yml" is encrypted.   [Open Decrypted]   [Dismiss]
```

Clicking **Open Decrypted** prompts for the password and opens the file in a `vault://` virtual editor. The decrypted content is shown in YAML mode. **The real file on disk remains encrypted at all times.**

When you save (`Ctrl+S`), the content is re-encrypted and written back to the real file.

### Commands

All commands are available in the **Command Palette** (`Ctrl+Shift+P`) and in right-click menus in the editor and Explorer.

| Command | Description |
|---|---|
| `Ansible Vault: Open Decrypted` | Open the active vault in an editable decrypted view |
| `Ansible Vault: Preview Decrypted (read-only)` | Peek at the content without entering edit mode |
| `Ansible Vault: Encrypt File` | Encrypt the current plain-text file as an Ansible vault |
| `Ansible Vault: New Encrypted File` | Create a new vault file and open it for editing |
| `Ansible Vault: Re-key (Change Password)` | Decrypt with the old password and re-encrypt with a new one |
| `Ansible Vault: Scan Workspace for Unencrypted Vaults` | Find files matching vault patterns that are not encrypted |
| `Ansible Vault: Install Git Pre-commit Hook` | Install a hook that blocks committing unencrypted vault files |
| `Ansible Vault: Clear Cached Passwords` | Wipe all in-memory cached passwords |

### Keyboard shortcuts

| Action | Windows / Linux | macOS |
|---|---|---|
| Open Decrypted | `Ctrl+Shift+V` `Ctrl+Shift+O` | `Cmd+Shift+V` `Cmd+Shift+O` |
| Encrypt File | `Ctrl+Shift+V` `Ctrl+Shift+E` | `Cmd+Shift+V` `Cmd+Shift+E` |

---

## Git protection

### Pre-commit hook

Run **`Ansible Vault: Install Git Pre-commit Hook`** once per repository. It writes (or appends to) `.git/hooks/pre-commit` with a POSIX sh script that refuses any commit where a staged file:

- matches a vault-pattern name (e.g. `*.vault`, `secrets.yml`), **and**
- does **not** start with `$ANSIBLE_VAULT`

The hook works on Linux, macOS, and **Windows with Git Bash** (the standard Git for Windows installation).

Example blocked commit:

```
[ansible-vault] ERROR: group_vars/all/secrets.yml matches vault pattern but is NOT encrypted!

[ansible-vault] Commit blocked. Encrypt the file(s) above before committing.
  Use the VS Code command: 'Ansible Vault: Encrypt File'
  or run: ansible-vault encrypt <file>
```

### Workspace scanner

**`Ansible Vault: Scan Workspace for Unencrypted Vaults`** walks every file in the workspace that matches a vault-name pattern and lists the ones that are NOT encrypted. Results are shown in a quick-pick so you can navigate directly to any offending file.

### Status bar warning

If the active file matches a vault pattern but is not encrypted, the status bar turns orange:

```
⚠ Vault NOT encrypted!
```

Clicking it runs `Ansible Vault: Encrypt File`.

---

## Settings

Open **Settings** (`Ctrl+,`) and search for `Ansible Vault`.

| Setting | Default | Description |
|---|---|---|
| `ansibleVault.rememberPassword` | `"session"` | `"never"` — ask every time; `"session"` — remember in memory until VS Code closes; `"keychain"` — persist in VS Code SecretStorage |
| `ansibleVault.vaultFilePatterns` | `["*.vault", "vault.yml", ...]` | File-name patterns treated as vault files for warnings, scanning, and the git hook |
| `ansibleVault.warnOnUnencryptedVaultFiles` | `true` | Show status-bar warning when a vault-pattern file is not encrypted |
| `ansibleVault.autoPromptOnOpen` | `true` | Automatically offer to open encrypted files in decrypted view |

---

## Ansible Vault format compatibility

The extension implements the Ansible Vault wire format exactly:

- **Format 1.1** — `$ANSIBLE_VAULT;1.1;AES256` (no vault ID)
- **Format 1.2** — `$ANSIBLE_VAULT;1.2;AES256;<vault-id>` (with vault ID)

Key derivation: **PBKDF2-SHA256**, 10 000 iterations, 80-byte output.
Encryption: **AES-256-CTR**.
Integrity: **HMAC-SHA256** of the ciphertext, verified before decryption.

Files encrypted by this extension can be decrypted with the standard `ansible-vault` CLI and vice versa.

---

## Security notes

- **No plaintext on disk.** The `vault://` virtual filesystem exists only in memory. VS Code never writes the decrypted content to a temporary file.
- **HMAC verification.** The HMAC is always checked before decryption, so a wrong password or corrupted file is caught immediately.
- **Timing-safe comparison.** HMAC comparison uses `crypto.timingSafeEqual` to prevent timing attacks.
- **Password storage.** With the default `"session"` strategy, passwords are held in a plain JS `Map` in the extension process and are lost when VS Code closes. With `"keychain"`, they are stored in VS Code's `SecretStorage` (backed by the OS credential store on Windows/macOS/Linux).

---

## Testing

### 1 — Crypto unit tests (no VS Code needed)

No test framework required — just Node.js:

```bash
node test/cryptoTest.js
```

Expected output:

```
Round-trip tests
  ✓  encrypt + decrypt returns original plaintext
  ✓  round-trip with vault ID (1.2 format)
  ✓  each encryption produces a different ciphertext (random salt)
  ✓  wrong password throws
  ✓  corrupted data throws

isVaultEncrypted tests
  ✓  detects 1.1 vault
  ✓  detects 1.2 vault
  ✓  rejects plain text
  ✓  rejects empty string

parseHeader tests
  ✓  parseHeader 1.1
  ✓  parseHeader 1.2 with vault ID
  ✓  parseHeader returns null for non-vault

Results: 12 passed, 0 failed
```

### 2 — Launch the extension in VS Code

1. Open the project folder in VS Code: **File → Open Folder** → `ansible-vault-for-windows`
2. Press `F5` (or **Run → Start Debugging**)

A second VS Code window opens — the **Extension Development Host**. All tests below are performed in that second window. Errors and `console.log` output appear in the first window's **Debug Console** tab.

> The `.vscode/launch.json` file at the root of the project provides the `F5` configuration — no extra setup needed.

### 3 — Manual test checklist

The `test/` folder contains two ready-made files:

| File | Purpose |
|---|---|
| `test/sample.vault` | A real encrypted vault. Password: **`test1234`** |
| `test/plain_to_encrypt.yml` | A plain-text YAML file to test in-place encryption |

Open the `test/` folder in the Extension Development Host window and work through these scenarios:

#### Open a vault decrypted

1. Open `test/sample.vault`
2. A notification appears: *"Ansible Vault: 'sample.vault' is encrypted. — Open Decrypted"*
3. Click **Open Decrypted**, enter password `test1234`
4. A new editor tab opens showing the plain YAML content. Edit something and save (`Ctrl+S`)
5. Verify the file on disk still starts with `$ANSIBLE_VAULT` — it should, the plaintext never touched the disk

#### Encrypt a plain file

1. Open `test/plain_to_encrypt.yml`
2. Right-click in the editor → **Ansible Vault: Encrypt File**, enter a password
3. The file is replaced in-place with encrypted content (first line becomes `$ANSIBLE_VAULT;1.1;AES256`)

#### Create a new vault

1. `Ctrl+Shift+P` → **Ansible Vault: New Encrypted File**
2. Choose a save location and set a password
3. Start typing — saving (`Ctrl+S`) encrypts automatically

#### Re-key (change password)

1. Open `test/sample.vault`
2. Right-click → **Ansible Vault: Re-key (Change Password)**
3. Enter old password (`test1234`), then a new one
4. Verify you can open the file again with the new password

#### Workspace scanner

1. `Ctrl+Shift+P` → **Ansible Vault: Scan Workspace for Unencrypted Vaults**
2. If `plain_to_encrypt.yml` hasn't been encrypted yet, it appears in the list
3. Clicking an entry in the list navigates directly to the file

#### Git pre-commit hook

1. `Ctrl+Shift+P` → **Ansible Vault: Install Git Pre-commit Hook**
2. Inspect `.git/hooks/pre-commit` — a shell script is written there
3. Stage `plain_to_encrypt.yml` and try to commit — the hook should block it with an error message

#### Status bar

| Situation | Expected status bar |
|---|---|
| Active file is an encrypted vault | `🔒 Encrypted Vault` |
| Active file is open in decrypted view | `🔓 Vault (decrypted view)` |
| Active file matches a vault pattern but is NOT encrypted | `⚠ Vault NOT encrypted!` (orange) |
| Any other file | Status bar item hidden |

Clicking the orange warning runs **Ansible Vault: Encrypt File** immediately.

### 4 — Interop with the real `ansible-vault` CLI (optional)

If you have access to a Linux or macOS machine with Ansible installed, you can verify full compatibility:

```bash
# Decrypt what the extension produced
ansible-vault decrypt --vault-password-file <(echo test1234) test/sample.vault --output -

# Encrypt something with the CLI and open it with the extension
echo "secret: hello" > /tmp/mysecret.yml
ansible-vault encrypt --vault-password-file <(echo mypassword) /tmp/mysecret.yml
# Now open /tmp/mysecret.yml in the Extension Development Host
```

---

## Project structure

```
ansible-vault-for-windows/
├── src/
│   ├── extension.js        # Extension entry point, commands, decorations
│   ├── vaultCrypto.js      # AES-256-CTR encrypt/decrypt (no external deps)
│   ├── vaultFileSystem.js  # vault:// FileSystemProvider
│   ├── passwordManager.js  # Password caching (session / keychain / never)
│   ├── statusBar.js        # Status bar item
│   └── gitGuard.js         # Pre-commit hook + workspace scanner
├── test/
│   └── cryptoTest.js       # Self-contained crypto tests
├── package.json
└── README.md
```

---

## License

MIT
