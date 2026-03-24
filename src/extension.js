'use strict';

/**
 * Ansible Vault for Windows – VS Code Extension
 *
 * Entry point.  Registers:
 *   • VaultFileSystemProvider  (vault:// scheme)
 *   • Commands
 *   • Status-bar item
 *   • Auto-detection of vault files on open
 *   • File-decoration provider (lock icons in Explorer)
 */

const vscode = require('vscode');
const path   = require('path');

const { isVaultEncrypted, parseHeader, decrypt, encrypt } = require('./vaultCrypto');
const { PasswordManager }          = require('./passwordManager');
const { VaultFileSystemProvider }  = require('./vaultFileSystem');
const { VaultStatusBar }           = require('./statusBar');
const { installPreCommitHook, scanWorkspace } = require('./gitGuard');

// ---------------------------------------------------------------------------

/** @param {vscode.ExtensionContext} context */
function activate(context) {

    // -----------------------------------------------------------------------
    // Core services
    // -----------------------------------------------------------------------

    const pm  = new PasswordManager(context);
    const vfs = new VaultFileSystemProvider(pm);
    const sb  = new VaultStatusBar();

    // -----------------------------------------------------------------------
    // File system provider (vault:// scheme)
    // -----------------------------------------------------------------------

    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider('vault', vfs, {
            isCaseSensitive: process.platform !== 'win32',
            isReadonly:      false,
        })
    );

    // -----------------------------------------------------------------------
    // File decoration provider – lock icon in Explorer
    // -----------------------------------------------------------------------

    const decorationProvider = new VaultFileDecorationProvider();
    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(decorationProvider)
    );

    // -----------------------------------------------------------------------
    // Status bar
    // -----------------------------------------------------------------------

    context.subscriptions.push(...sb.activate());

    // -----------------------------------------------------------------------
    // Auto-detect vault files when opened
    // -----------------------------------------------------------------------

    // Check files already open at activation time
    for (const doc of vscode.workspace.textDocuments) {
        maybePromptVaultOpen(doc, vfs);
    }

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => maybePromptVaultOpen(doc, vfs))
    );

    // -----------------------------------------------------------------------
    // Commands
    // -----------------------------------------------------------------------

    // Open vault file as decrypted virtual document
    context.subscriptions.push(
        vscode.commands.registerCommand('ansible-vault.openDecrypted', async (uri) => {
            uri = uri || vscode.window.activeTextEditor?.document?.uri;
            if (!uri || uri.scheme === 'vault') return;
            await vfs.openDecrypted(uri);
        })
    );

    // Encrypt the current plain-text file in-place as an Ansible vault
    context.subscriptions.push(
        vscode.commands.registerCommand('ansible-vault.encryptFile', async (uri) => {
            uri = uri || vscode.window.activeTextEditor?.document?.uri;
            if (!uri || uri.scheme === 'vault') {
                vscode.window.showWarningMessage('Ansible Vault: Select a plain-text file to encrypt.');
                return;
            }
            await encryptFileCommand(uri, pm);
        })
    );

    // Decrypt vault inline and show as plain text (read-only, for quick inspection)
    context.subscriptions.push(
        vscode.commands.registerCommand('ansible-vault.viewDecryptedInline', async (uri) => {
            uri = uri || vscode.window.activeTextEditor?.document?.uri;
            if (!uri) return;
            await viewDecryptedInline(uri, pm);
        })
    );

    // Re-key: change the password of a vault
    context.subscriptions.push(
        vscode.commands.registerCommand('ansible-vault.rekey', async (uri) => {
            uri = uri || vscode.window.activeTextEditor?.document?.uri;
            if (!uri) return;
            await rekeyCommand(uri, pm, vfs);
        })
    );

    // Create a new empty vault file
    context.subscriptions.push(
        vscode.commands.registerCommand('ansible-vault.newVault', async () => {
            await newVaultCommand(pm, vfs);
        })
    );

    // Scan workspace for unencrypted vault-pattern files
    context.subscriptions.push(
        vscode.commands.registerCommand('ansible-vault.scanWorkspace', async () => {
            await scanWorkspace();
        })
    );

    // Install git pre-commit hook
    context.subscriptions.push(
        vscode.commands.registerCommand('ansible-vault.installGitHook', async () => {
            await installPreCommitHook();
        })
    );

    // Clear cached passwords
    context.subscriptions.push(
        vscode.commands.registerCommand('ansible-vault.clearCachedPasswords', async () => {
            await pm.forgetAll();
        })
    );

    console.log('Ansible Vault for Windows: activated');
}

function deactivate() {}

// ---------------------------------------------------------------------------
// Auto-detect helper
// ---------------------------------------------------------------------------

/** @type {Set<string>} paths already prompted this session */
const _prompted = new Set();

/**
 * If the document is an encrypted vault and the user hasn't been prompted yet,
 * show a non-intrusive notification.
 * @param {vscode.TextDocument} doc
 * @param {VaultFileSystemProvider} vfs
 */
function maybePromptVaultOpen(doc, vfs) {
    if (doc.uri.scheme !== 'file') return;
    if (_prompted.has(doc.uri.fsPath)) return;

    const text = doc.getText();
    if (!isVaultEncrypted(text)) return;

    _prompted.add(doc.uri.fsPath);

    const info = parseHeader(text);
    const label = info?.vaultId ? ` (id: ${info.vaultId})` : '';

    vscode.window.showInformationMessage(
        `Ansible Vault${label}: "${path.basename(doc.fileName)}" is encrypted.`,
        'Open Decrypted',
        'Dismiss'
    ).then(action => {
        if (action === 'Open Decrypted') {
            vfs.openDecrypted(doc.uri);
        }
    });
}

// ---------------------------------------------------------------------------
// Command implementations
// ---------------------------------------------------------------------------

/**
 * Encrypt an existing plain-text file in-place.
 */
async function encryptFileCommand(uri, pm) {
    const filePath = uri.fsPath;

    // Safety check: don't re-encrypt an already encrypted file
    try {
        const bytes   = await vscode.workspace.fs.readFile(uri);
        const content = Buffer.from(bytes).toString('utf8');
        if (isVaultEncrypted(content)) {
            vscode.window.showInformationMessage('Ansible Vault: This file is already encrypted.');
            return;
        }
    } catch (e) {
        vscode.window.showErrorMessage(`Ansible Vault: Cannot read file – ${e.message}`);
        return;
    }

    // Ask for password (with confirmation)
    const pw1 = await vscode.window.showInputBox({
        prompt:         `Vault password for "${path.basename(filePath)}"`,
        password:       true,
        ignoreFocusOut: true,
        placeHolder:    'Enter new vault password',
    });
    if (!pw1) return;

    const pw2 = await vscode.window.showInputBox({
        prompt:         'Confirm vault password',
        password:       true,
        ignoreFocusOut: true,
        placeHolder:    'Re-enter vault password',
    });
    if (!pw2) return;

    if (pw1 !== pw2) {
        vscode.window.showErrorMessage('Ansible Vault: Passwords do not match.');
        return;
    }

    // Optional vault ID
    const vaultId = await vscode.window.showInputBox({
        prompt:       'Vault ID (optional, leave blank for default)',
        ignoreFocusOut: true,
        placeHolder:  'e.g. dev, prod  –  press Enter to skip',
    });

    try {
        const bytes     = await vscode.workspace.fs.readFile(uri);
        const plaintext = Buffer.from(bytes).toString('utf8');
        const vaultText = encrypt(plaintext, pw1, vaultId?.trim() || null);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(vaultText, 'utf8'));
        await pm.set(filePath, pw1);
        vscode.window.showInformationMessage(`Ansible Vault: "${path.basename(filePath)}" encrypted successfully.`);
    } catch (e) {
        vscode.window.showErrorMessage(`Ansible Vault: Encryption failed – ${e.message}`);
    }
}

/**
 * Show decrypted vault content in a read-only virtual document (no disk write).
 */
async function viewDecryptedInline(uri, pm) {
    if (uri.scheme === 'vault') {
        vscode.window.showInformationMessage('Already in decrypted view.');
        return;
    }

    let content;
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        content = Buffer.from(bytes).toString('utf8');
    } catch (e) {
        vscode.window.showErrorMessage(`Ansible Vault: Cannot read file – ${e.message}`);
        return;
    }

    if (!isVaultEncrypted(content)) {
        vscode.window.showInformationMessage('Ansible Vault: File is not encrypted.');
        return;
    }

    const password = await pm.getPassword(uri.fsPath, `Password for ${path.basename(uri.fsPath)}`);
    if (!password) return;

    let plaintext;
    try {
        plaintext = decrypt(content, password);
    } catch (e) {
        await pm.forget(uri.fsPath);
        vscode.window.showErrorMessage(`Ansible Vault: ${e.message}`);
        return;
    }

    // Show in an untitled document (read-only, not saved to disk)
    const doc = await vscode.workspace.openTextDocument({
        content:  plaintext,
        language: 'yaml',
    });
    await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
    vscode.window.showInformationMessage(
        'Ansible Vault: This is a read-only preview. Use "Open Decrypted" to edit.'
    );
}

/**
 * Change the password of an encrypted vault file.
 */
async function rekeyCommand(uri, pm, vfs) {
    if (uri.scheme === 'vault') {
        // Get the real URI from the vault URI
        uri = vscode.Uri.file(uri.path);
    }

    let content;
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        content = Buffer.from(bytes).toString('utf8');
    } catch (e) {
        vscode.window.showErrorMessage(`Ansible Vault: Cannot read file – ${e.message}`);
        return;
    }

    if (!isVaultEncrypted(content)) {
        vscode.window.showInformationMessage('Ansible Vault: File is not encrypted.');
        return;
    }

    // Current password
    const oldPw = await pm.getPassword(uri.fsPath, `Current password for "${path.basename(uri.fsPath)}"`);
    if (!oldPw) return;

    let plaintext;
    try {
        plaintext = decrypt(content, oldPw);
    } catch (e) {
        await pm.forget(uri.fsPath);
        vscode.window.showErrorMessage(`Ansible Vault: ${e.message}`);
        return;
    }

    // New password
    const newPw1 = await vscode.window.showInputBox({
        prompt:         'New vault password',
        password:       true,
        ignoreFocusOut: true,
        placeHolder:    'Enter new password',
    });
    if (!newPw1) return;

    const newPw2 = await vscode.window.showInputBox({
        prompt:         'Confirm new vault password',
        password:       true,
        ignoreFocusOut: true,
        placeHolder:    'Re-enter new password',
    });
    if (!newPw2) return;

    if (newPw1 !== newPw2) {
        vscode.window.showErrorMessage('Ansible Vault: Passwords do not match.');
        return;
    }

    try {
        const info      = parseHeader(content);
        const vaultText = encrypt(plaintext, newPw1, info?.vaultId ?? null);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(vaultText, 'utf8'));
        await pm.forget(uri.fsPath);
        await pm.set(uri.fsPath, newPw1);
        vfs.invalidatePassword(uri);
        vscode.window.showInformationMessage(`Ansible Vault: "${path.basename(uri.fsPath)}" re-keyed successfully.`);
    } catch (e) {
        vscode.window.showErrorMessage(`Ansible Vault: Re-key failed – ${e.message}`);
    }
}

/**
 * Create a new encrypted vault file.
 */
async function newVaultCommand(pm, vfs) {
    // Pick a save location
    const saveUri = await vscode.window.showSaveDialog({
        title:       'Create New Ansible Vault',
        filters:     {
            'Ansible Vault': ['vault', 'yml', 'yaml'],
            'All Files':     ['*'],
        },
        defaultUri:  vscode.workspace.workspaceFolders?.[0]?.uri,
    });
    if (!saveUri) return;

    // Password
    const pw1 = await vscode.window.showInputBox({
        prompt:         `Vault password for "${path.basename(saveUri.fsPath)}"`,
        password:       true,
        ignoreFocusOut: true,
        placeHolder:    'Enter vault password',
    });
    if (!pw1) return;

    const pw2 = await vscode.window.showInputBox({
        prompt:         'Confirm vault password',
        password:       true,
        ignoreFocusOut: true,
        placeHolder:    'Re-enter vault password',
    });
    if (!pw2) return;

    if (pw1 !== pw2) {
        vscode.window.showErrorMessage('Ansible Vault: Passwords do not match.');
        return;
    }

    // Optional vault ID
    const vaultId = await vscode.window.showInputBox({
        prompt:         'Vault ID (optional)',
        ignoreFocusOut: true,
        placeHolder:    'e.g. dev, prod  –  press Enter to skip',
    });

    // Initial content
    const defaultContent = '---\n# Add your secrets below\n';
    const vaultText      = encrypt(defaultContent, pw1, vaultId?.trim() || null);

    try {
        await vscode.workspace.fs.writeFile(saveUri, Buffer.from(vaultText, 'utf8'));
        await pm.set(saveUri.fsPath, pw1);
        // Immediately open the new file in decrypted view
        await vfs.openDecrypted(saveUri);
    } catch (e) {
        vscode.window.showErrorMessage(`Ansible Vault: Failed to create vault – ${e.message}`);
    }
}

// ---------------------------------------------------------------------------
// File decoration provider (lock icons in Explorer tree)
// ---------------------------------------------------------------------------

class VaultFileDecorationProvider {
    constructor() {
        this._emitter = new vscode.EventEmitter();
        this.onDidChangeFileDecorations = this._emitter.event;
    }

    /** @param {vscode.Uri} uri */
    async provideFileDecoration(uri) {
        if (uri.scheme === 'vault') {
            return {
                badge:   '🔓',
                tooltip: 'Ansible Vault – decrypted view',
                color:   new vscode.ThemeColor('charts.green'),
            };
        }

        if (uri.scheme !== 'file') return undefined;

        // Read first 40 bytes to check for vault header (fast)
        try {
            const bytes   = await vscode.workspace.fs.readFile(uri);
            const snippet = Buffer.from(bytes.slice(0, 40)).toString('ascii');
            if (isVaultEncrypted(snippet)) {
                return {
                    badge:   '🔒',
                    tooltip: 'Ansible Vault – encrypted',
                };
            }
        } catch (_) {}

        return undefined;
    }
}

// ---------------------------------------------------------------------------

module.exports = { activate, deactivate };
