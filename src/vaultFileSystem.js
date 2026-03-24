'use strict';

/**
 * VaultFileSystemProvider  (scheme: "vault")
 *
 * Maps  vault://localhost/<abs-path>  →  real file at <abs-path>
 *
 * readFile  : reads the real encrypted file and returns decrypted bytes.
 * writeFile : encrypts the supplied bytes and writes them to the real file.
 *
 * All other FS operations are delegated to the real file so that VS Code
 * metadata (stat, watch, …) stays correct.
 */

const vscode = require('vscode');
const { decrypt, encrypt, isVaultEncrypted } = require('./vaultCrypto');

class VaultFileSystemProvider {
    /**
     * @param {import('./passwordManager').PasswordManager} passwordManager
     */
    constructor(passwordManager) {
        this._pm = passwordManager;

        /** @type {vscode.EventEmitter<vscode.FileChangeEvent[]>} */
        this._emitter = new vscode.EventEmitter();
        /** @type {vscode.Event<vscode.FileChangeEvent[]>} */
        this.onDidChangeFile = this._emitter.event;

        /**
         * Track which vault URI → password so writeFile can encrypt with the
         * same password that was used to decrypt (avoids re-prompting on save).
         * @type {Map<string, string>}
         */
        this._activePasswords = new Map();
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Convert a vault:// URI to the real file:// URI. */
    _realUri(vaultUri) {
        return vscode.Uri.file(vaultUri.path);
    }

    _uriKey(vaultUri) {
        return vaultUri.toString();
    }

    // -----------------------------------------------------------------------
    // Required: FileSystemProvider interface
    // -----------------------------------------------------------------------

    watch(uri, options) {
        // Delegate watching to the real file and re-emit as vault:// events.
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(
                vscode.Uri.file(require('path').dirname(uri.path)),
                require('path').basename(uri.path)
            )
        );
        const fire = (type) => (changedUri) => {
            if (changedUri.fsPath === uri.path) {
                this._emitter.fire([{ type, uri }]);
            }
        };
        watcher.onDidChange(fire(vscode.FileChangeType.Changed));
        watcher.onDidCreate(fire(vscode.FileChangeType.Created));
        watcher.onDidDelete(fire(vscode.FileChangeType.Deleted));
        return watcher; // disposable
    }

    async stat(uri) {
        return vscode.workspace.fs.stat(this._realUri(uri));
    }

    readDirectory(uri) {
        throw vscode.FileSystemError.FileNotADirectory(uri);
    }

    createDirectory(uri) {
        throw vscode.FileSystemError.NoPermissions('Cannot create directory through vault:// scheme');
    }

    async readFile(uri) {
        const realUri = this._realUri(uri);

        // Read encrypted content from the real file
        const encBytes = await vscode.workspace.fs.readFile(realUri);
        const encText  = Buffer.from(encBytes).toString('utf8');

        if (!isVaultEncrypted(encText)) {
            // File is not encrypted – return as-is (allows re-use of scheme for unencrypted files)
            return encBytes;
        }

        const filePath = realUri.fsPath;
        let password = this._activePasswords.get(this._uriKey(uri));

        if (!password) {
            password = await this._pm.getPassword(filePath, `Password for ${require('path').basename(filePath)}`);
            if (!password) {
                throw vscode.FileSystemError.NoPermissions('Password required to decrypt vault');
            }
        }

        let plaintext;
        try {
            plaintext = decrypt(encText, password);
        } catch (err) {
            // Forget bad cached password and rethrow so VS Code shows an error
            await this._pm.forget(filePath);
            this._activePasswords.delete(this._uriKey(uri));
            throw vscode.FileSystemError.NoPermissions(`Decryption failed: ${err.message}`);
        }

        this._activePasswords.set(this._uriKey(uri), password);
        return Buffer.from(plaintext, 'utf8');
    }

    async writeFile(uri, content, options) {
        const realUri = this._realUri(uri);
        const filePath = realUri.fsPath;

        let password = this._activePasswords.get(this._uriKey(uri));

        if (!password) {
            // This can happen if the user somehow creates a new vault:// file.
            // Ask for a password and ask to confirm it.
            password = await this._promptNewPassword(require('path').basename(filePath));
            if (!password) {
                throw vscode.FileSystemError.NoPermissions('Password required to encrypt vault');
            }
            this._activePasswords.set(this._uriKey(uri), password);
            await this._pm.set(filePath, password);
        }

        const plaintext  = Buffer.from(content).toString('utf8');
        const vaultText  = encrypt(plaintext, password);
        const vaultBytes = Buffer.from(vaultText, 'utf8');

        await vscode.workspace.fs.writeFile(realUri, vaultBytes);

        // Notify VS Code the real file changed (for external watchers)
        this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    async delete(uri, options) {
        return vscode.workspace.fs.delete(this._realUri(uri), options);
    }

    async rename(oldUri, newUri, options) {
        // Rename the real files; we cannot rename across schemes here
        const oldReal = this._realUri(oldUri);
        const newReal = this._realUri(newUri);
        await vscode.workspace.fs.rename(oldReal, newReal, options);

        // Move cached password to new key
        const pw = this._activePasswords.get(this._uriKey(oldUri));
        if (pw) {
            this._activePasswords.delete(this._uriKey(oldUri));
            this._activePasswords.set(this._uriKey(newUri), pw);
        }
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    async _promptNewPassword(label) {
        const pw1 = await vscode.window.showInputBox({
            prompt:          `New vault password for "${label}"`,
            password:        true,
            ignoreFocusOut:  true,
            placeHolder:     'Enter password',
        });
        if (!pw1) return undefined;

        const pw2 = await vscode.window.showInputBox({
            prompt:          'Confirm vault password',
            password:        true,
            ignoreFocusOut:  true,
            placeHolder:     'Re-enter password',
        });
        if (!pw2) return undefined;

        if (pw1 !== pw2) {
            vscode.window.showErrorMessage('Ansible Vault: passwords do not match.');
            return undefined;
        }
        return pw1;
    }

    /**
     * Open a vault URI in a new editor tab.
     * Called by extension commands.
     * @param {vscode.Uri} realFileUri
     */
    async openDecrypted(realFileUri) {
        const vaultUri = vscode.Uri.from({
            scheme:    'vault',
            authority: 'localhost',
            path:      realFileUri.path,  // forward-slash path, works on Windows too
        });

        // Clear any stale cached password so readFile prompts fresh if needed
        const key = this._uriKey(vaultUri);
        if (!this._activePasswords.has(key)) {
            // Will be fetched during readFile
        }

        try {
            const doc = await vscode.workspace.openTextDocument(vaultUri);
            // Try to use YAML language mode for nicer editing experience
            await vscode.languages.setTextDocumentLanguage(doc, 'yaml').catch(() => {});
            await vscode.window.showTextDocument(doc, { preview: false });
        } catch (err) {
            vscode.window.showErrorMessage(`Ansible Vault: ${err.message}`);
        }
    }

    /**
     * Force-forget the password associated with a vault:// URI.
     * Useful after re-key.
     * @param {vscode.Uri} realFileUri
     */
    invalidatePassword(realFileUri) {
        const vaultUri = vscode.Uri.from({
            scheme: 'vault', authority: 'localhost', path: realFileUri.path,
        });
        this._activePasswords.delete(this._uriKey(vaultUri));
    }
}

module.exports = { VaultFileSystemProvider };
