'use strict';

const vscode = require('vscode');
const { isVaultEncrypted } = require('./vaultCrypto');

/**
 * Shows a status-bar item indicating whether the active file is:
 *   🔒 Encrypted vault
 *   🔓 Open (decrypted view)   ← vault:// scheme
 *   ⚠  Should be encrypted but isn't
 *   (hidden for unrelated files)
 */
class VaultStatusBar {
    constructor() {
        this._item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this._item.command = 'ansible-vault.openDecrypted';
    }

    /** @returns {vscode.Disposable[]} */
    activate() {
        return [
            this._item,
            vscode.window.onDidChangeActiveTextEditor(e => this._update(e)),
            vscode.workspace.onDidOpenTextDocument(() => this._update(vscode.window.activeTextEditor)),
            vscode.workspace.onDidSaveTextDocument(() => this._update(vscode.window.activeTextEditor)),
        ];
    }

    /** @param {vscode.TextEditor|undefined} editor */
    _update(editor) {
        if (!editor) { this._item.hide(); return; }

        const doc    = editor.document;
        const scheme = doc.uri.scheme;

        if (scheme === 'vault') {
            this._item.text    = '$(unlock) Vault (decrypted view)';
            this._item.tooltip = 'Editing Ansible Vault – file on disk stays encrypted.\nClick to open another vault.';
            this._item.backgroundColor = undefined;
            this._item.show();
            return;
        }

        if (scheme !== 'file') { this._item.hide(); return; }

        const text = doc.getText();

        if (isVaultEncrypted(text)) {
            this._item.text      = '$(lock) Encrypted Vault';
            this._item.tooltip   = 'This file is an Ansible Vault.\nClick to open decrypted.';
            this._item.command   = 'ansible-vault.openDecrypted';
            this._item.backgroundColor = undefined;
            this._item.show();
            return;
        }

        // Check if the file name matches vault patterns and is NOT encrypted
        const patterns = vscode.workspace.getConfiguration('ansibleVault').get('vaultFilePatterns', []);
        const name     = require('path').basename(doc.fileName).toLowerCase();
        const looks    = patterns.some(p => {
            const re = new RegExp('^' + p.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i');
            return re.test(name);
        });

        if (looks && vscode.workspace.getConfiguration('ansibleVault').get('warnOnUnencryptedVaultFiles', true)) {
            this._item.text            = '$(warning) Vault NOT encrypted!';
            this._item.tooltip         = `"${name}" matches a vault pattern but is not encrypted.\nClick to encrypt.`;
            this._item.command         = 'ansible-vault.encryptFile';
            this._item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this._item.show();
            return;
        }

        this._item.hide();
    }

    dispose() {
        this._item.dispose();
    }
}

module.exports = { VaultStatusBar };
