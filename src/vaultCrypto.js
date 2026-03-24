'use strict';

/**
 * Ansible Vault crypto operations using only Node.js built-in crypto module.
 * Implements AES-256-CTR encryption compatible with ansible-vault 1.1 and 1.2.
 *
 * Vault format:
 *   $ANSIBLE_VAULT;1.1;AES256\n
 *   <hex-encoded outer data, 80 chars per line>
 *
 * Outer hex decodes to an ASCII string: hex(salt)\nhex(hmac)\nhex(ciphertext)
 * Keys derived via PBKDF2-SHA256 (10000 iterations, 80 bytes):
 *   bytes  0-31 : AES-256 encryption key
 *   bytes 32-63 : HMAC-SHA256 key
 *   bytes 64-79 : AES-256-CTR IV
 */

const crypto = require('crypto');

const HEADER_V1_1 = '$ANSIBLE_VAULT;1.1;AES256';
const HEADER_V1_2_PREFIX = '$ANSIBLE_VAULT;1.2;AES256;';
const ITERATIONS = 10000;
const KEY_LEN = 32;
const IV_LEN = 16;
const DERIVED_LEN = KEY_LEN * 2 + IV_LEN; // 80

/**
 * Returns true if the string looks like an Ansible vault.
 * @param {string} content
 */
function isVaultEncrypted(content) {
    if (typeof content !== 'string') return false;
    const firstLine = content.trimStart().split('\n')[0].trim();
    return firstLine === HEADER_V1_1 || firstLine.startsWith(HEADER_V1_2_PREFIX);
}

/**
 * Parse the vault header and return { version, vaultId }.
 * @param {string} content
 */
function parseHeader(content) {
    const firstLine = content.trimStart().split('\n')[0].trim();
    if (firstLine === HEADER_V1_1) {
        return { version: '1.1', vaultId: null };
    }
    if (firstLine.startsWith(HEADER_V1_2_PREFIX)) {
        const vaultId = firstLine.slice(HEADER_V1_2_PREFIX.length) || null;
        return { version: '1.2', vaultId };
    }
    return null;
}

/**
 * Derive AES key, HMAC key, and IV from password + salt.
 */
function deriveKeys(password, salt) {
    const pwBuf = Buffer.isBuffer(password) ? password : Buffer.from(password, 'utf8');
    const derived = crypto.pbkdf2Sync(pwBuf, salt, ITERATIONS, DERIVED_LEN, 'sha256');
    return {
        key1: derived.slice(0, KEY_LEN),
        key2: derived.slice(KEY_LEN, KEY_LEN * 2),
        iv:   derived.slice(KEY_LEN * 2),
    };
}

/**
 * Decrypt an Ansible vault file.
 * @param {string} vaultText  Full vault file content.
 * @param {string} password
 * @returns {string} Decrypted plaintext.
 * @throws {Error} On bad password or corrupted data.
 */
function decrypt(vaultText, password) {
    const lines = vaultText.trim().split('\n');
    if (!parseHeader(vaultText)) {
        throw new Error('Not a valid Ansible vault file');
    }

    // Decode outer hex (lines 1+, ignoring whitespace)
    const outerHex = lines.slice(1).join('').replace(/\s/g, '');
    if (!outerHex || outerHex.length % 2 !== 0) {
        throw new Error('Corrupted vault: invalid hex data');
    }

    // Inner bytes encode:  hex(salt)\nhex(hmac)\nhex(ciphertext)
    const inner = Buffer.from(outerHex, 'hex').toString('ascii');
    const parts = inner.split('\n');
    if (parts.length < 3) {
        throw new Error('Corrupted vault: unexpected inner structure');
    }

    const salt       = Buffer.from(parts[0].trim(), 'hex');
    const storedHmac = Buffer.from(parts[1].trim(), 'hex');
    const ciphertext = Buffer.from(parts[2].trim(), 'hex');

    const { key1, key2, iv } = deriveKeys(password, salt);

    // Verify HMAC before decrypting (prevents padding oracle / corruption)
    const computedHmac = crypto.createHmac('sha256', key2).update(ciphertext).digest();
    if (storedHmac.length !== computedHmac.length
        || !crypto.timingSafeEqual(storedHmac, computedHmac)) {
        throw new Error('Incorrect password or corrupted vault (HMAC mismatch)');
    }

    const decipher  = crypto.createDecipheriv('aes-256-ctr', key1, iv);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
}

/**
 * Encrypt plaintext as an Ansible vault file.
 * @param {string} plaintext
 * @param {string} password
 * @param {string|null} vaultId  Optional vault ID (produces 1.2 format).
 * @returns {string} Vault file content (always ends with \n).
 */
function encrypt(plaintext, password, vaultId = null) {
    const salt = crypto.randomBytes(32);
    const { key1, key2, iv } = deriveKeys(password, salt);

    const cipher     = crypto.createCipheriv('aes-256-ctr', key1, iv);
    const ciphertext = Buffer.concat([
        cipher.update(Buffer.from(plaintext, 'utf8')),
        cipher.final(),
    ]);

    const hmac = crypto.createHmac('sha256', key2).update(ciphertext).digest();

    // Build inner ASCII string and double-hex-encode
    const inner    = [salt.toString('hex'), hmac.toString('hex'), ciphertext.toString('hex')].join('\n');
    const outerHex = Buffer.from(inner, 'ascii').toString('hex');

    // Wrap at 80 chars per line (ansible convention)
    const wrapped = (outerHex.match(/.{1,80}/g) || [outerHex]).join('\n');

    const header = vaultId ? `$ANSIBLE_VAULT;1.2;AES256;${vaultId}` : HEADER_V1_1;
    return `${header}\n${wrapped}\n`;
}

module.exports = { isVaultEncrypted, parseHeader, decrypt, encrypt };
