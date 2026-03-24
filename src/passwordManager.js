'use strict';

const vscode = require('vscode');

/**
 * Manages vault passwords.
 * Supports three storage strategies controlled by ansibleVault.rememberPassword:
 *   "never"    – ask every time
 *   "session"  – store in memory for the lifetime of the VS Code window (default)
 *   "keychain" – store in VS Code SecretStorage (persists across sessions)
 *
 * The key used for caching is the vault file path so different files can have
 * different passwords.
 */
class PasswordManager {
    /**
     * @param {vscode.ExtensionContext} context
     */
    constructor(context) {
        this._secrets = context.secrets;
        /** @type {Map<string, string>} */
        this._session = new Map();
    }

    _strategy() {
        return vscode.workspace.getConfiguration('ansibleVault').get('rememberPassword', 'session');
    }

    /**
     * Ask the user for a password, honouring the caching strategy.
     * @param {string} filePath  Absolute path – used as cache key.
     * @param {string} [prompt]
     * @returns {Promise<string|undefined>} The password, or undefined if cancelled.
     */
    async getPassword(filePath, prompt = 'Ansible Vault password') {
        const strategy = this._strategy();

        // Try cache first
        if (strategy === 'session') {
            const cached = this._session.get(filePath);
            if (cached !== undefined) return cached;
        } else if (strategy === 'keychain') {
            const cached = await this._secrets.get(`vault:${filePath}`);
            if (cached !== undefined) return cached;
        }

        // Prompt user
        const password = await vscode.window.showInputBox({
            prompt,
            password: true,
            ignoreFocusOut: true,
            placeHolder: 'Enter vault password',
        });

        if (password === undefined) return undefined; // Cancelled

        // Store according to strategy
        if (strategy === 'session') {
            this._session.set(filePath, password);
        } else if (strategy === 'keychain') {
            await this._secrets.store(`vault:${filePath}`, password);
        }

        return password;
    }

    /**
     * Forget the cached password for a specific file.
     * @param {string} filePath
     */
    async forget(filePath) {
        this._session.delete(filePath);
        await this._secrets.delete(`vault:${filePath}`).catch(() => {});
    }

    /**
     * Forget all cached passwords (both session and keychain).
     */
    async forgetAll() {
        this._session.clear();
        // SecretStorage has no "list all keys" API, so we can only clear session.
        // Keychain entries will expire when the user changes files or re-keys.
        vscode.window.showInformationMessage('Ansible Vault: session passwords cleared.');
    }

    /**
     * Overwrite the cached password for a file (e.g., after re-key).
     * @param {string} filePath
     * @param {string} password
     */
    async set(filePath, password) {
        const strategy = this._strategy();
        if (strategy === 'session') {
            this._session.set(filePath, password);
        } else if (strategy === 'keychain') {
            await this._secrets.store(`vault:${filePath}`, password);
        }
    }
}

module.exports = { PasswordManager };
