'use strict';

/**
 * Git Guard
 *
 * Two layers of protection:
 *
 * 1. Pre-commit hook  – a shell script that refuses commits containing files
 *    that match vault-name patterns but are NOT encrypted.
 *    Works with Git Bash on Windows (standard Git for Windows install).
 *
 * 2. Workspace scanner  – a VS Code command that walks workspace files and
 *    reports any unencrypted vault candidates.
 *
 * The pre-commit hook is written in POSIX sh so it works on both Linux/macOS
 * and Git Bash on Windows without any extra tools.
 */

const vscode = require('vscode');
const path   = require('path');
const fs     = require('fs');
const { isVaultEncrypted } = require('./vaultCrypto');

// --------------------------------------------------------------------------
// Pre-commit hook script
// --------------------------------------------------------------------------

const HOOK_MARKER = '# ansible-vault-for-windows';

const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER}
# Installed by the "Ansible Vault for Windows" VS Code extension.
# Prevents committing files that look like Ansible vault candidates
# but whose content is NOT encrypted.

VAULT_PATTERNS="*.vault vault.yml vault.yaml secrets.yml secrets.yaml"

fail=0
for f in $(git diff --cached --name-only --diff-filter=ACM); do
    [ -f "$f" ] || continue
    base=$(basename "$f" | tr '[:upper:]' '[:lower:]')
    for pat in $VAULT_PATTERNS; do
        case "$base" in
            $pat)
                if ! head -1 "$f" 2>/dev/null | grep -q '^\$ANSIBLE_VAULT'; then
                    echo "[ansible-vault] ERROR: $f matches vault pattern but is NOT encrypted!"
                    fail=1
                fi
                ;;
        esac
    done
done

if [ $fail -ne 0 ]; then
    echo ""
    echo "[ansible-vault] Commit blocked. Encrypt the file(s) above before committing."
    echo "  Use the VS Code command: 'Ansible Vault: Encrypt File'"
    echo "  or run: ansible-vault encrypt <file>"
    exit 1
fi

exit 0
`;

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Install (or update) the pre-commit hook in the workspace git repo.
 */
async function installPreCommitHook() {
    const gitRoot = await findGitRoot();
    if (!gitRoot) {
        vscode.window.showWarningMessage(
            'Ansible Vault: No git repository found in the current workspace.'
        );
        return;
    }

    const hooksDir  = path.join(gitRoot, '.git', 'hooks');
    const hookFile  = path.join(hooksDir, 'pre-commit');

    try {
        fs.mkdirSync(hooksDir, { recursive: true });
    } catch (e) { /* already exists */ }

    let existing = '';
    try { existing = fs.readFileSync(hookFile, 'utf8'); } catch (_) { /* no hook yet */ }

    if (existing.includes(HOOK_MARKER)) {
        // Already installed – overwrite just our section
        const withoutOurs = existing
            .split(HOOK_MARKER)[0]
            .trimEnd();
        const updated = withoutOurs
            ? withoutOurs + '\n\n' + HOOK_SCRIPT
            : HOOK_SCRIPT;
        fs.writeFileSync(hookFile, updated, { mode: 0o755 });
        vscode.window.showInformationMessage('Ansible Vault: pre-commit hook updated.');
    } else if (existing.trim() === '' || existing.trim() === '#!/bin/sh') {
        // Empty or skeleton hook – replace entirely
        fs.writeFileSync(hookFile, HOOK_SCRIPT, { mode: 0o755 });
        vscode.window.showInformationMessage(
            `Ansible Vault: pre-commit hook installed at ${hookFile}`
        );
    } else {
        // There is already a different hook – append our check
        const combined = existing.trimEnd() + '\n\n' + HOOK_SCRIPT;
        fs.writeFileSync(hookFile, combined, { mode: 0o755 });
        vscode.window.showInformationMessage(
            'Ansible Vault: pre-commit check appended to existing hook.'
        );
    }

    // On Windows, ensure the hook file is executable via Git config
    // (Git for Windows reads the execute bit from the index, not the FS)
    try {
        const { execSync } = require('child_process');
        execSync(`git -C "${gitRoot}" update-index --chmod=+x .git/hooks/pre-commit`, {
            stdio: 'ignore',
        });
    } catch (_) { /* not a hard failure */ }
}

/**
 * Scan workspace files for unencrypted vault candidates.
 * Shows results in a VS Code quick-pick for easy navigation.
 */
async function scanWorkspace() {
    const patterns = vscode.workspace.getConfiguration('ansibleVault')
        .get('vaultFilePatterns', ['*.vault', 'vault.yml', 'vault.yaml', 'secrets.yml', 'secrets.yaml']);

    const globs    = patterns.map(p => `**/${p}`);
    const excludes = '**/{node_modules,.git,dist,build}/**';

    vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Scanning workspace for unencrypted vaults…' },
        async () => {
            const unencrypted = [];

            for (const glob of globs) {
                const uris = await vscode.workspace.findFiles(glob, excludes, 500);
                for (const uri of uris) {
                    try {
                        const bytes   = await vscode.workspace.fs.readFile(uri);
                        const content = Buffer.from(bytes).toString('utf8');
                        if (!isVaultEncrypted(content)) {
                            unencrypted.push(uri);
                        }
                    } catch (_) { /* skip unreadable */ }
                }
            }

            if (unencrypted.length === 0) {
                vscode.window.showInformationMessage(
                    'Ansible Vault: All vault-pattern files are encrypted. ✓'
                );
                return;
            }

            const items = unencrypted.map(uri => ({
                label:       path.basename(uri.fsPath),
                description: vscode.workspace.asRelativePath(uri),
                uri,
            }));
            items.unshift({
                label:       `$(warning) ${unencrypted.length} unencrypted vault file(s) found`,
                kind:        vscode.QuickPickItemKind.Separator,
            });

            const chosen = await vscode.window.showQuickPick(items, {
                placeHolder:  'Select a file to open and review',
                canPickMany:  false,
            });

            if (chosen && chosen.uri) {
                await vscode.window.showTextDocument(chosen.uri);
            }
        }
    );
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Walk up from the workspace root to find the .git directory.
 * @returns {Promise<string|null>}
 */
async function findGitRoot() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;

    let dir = folders[0].uri.fsPath;
    for (let i = 0; i < 20; i++) {
        if (fs.existsSync(path.join(dir, '.git'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

module.exports = { installPreCommitHook, scanWorkspace };
