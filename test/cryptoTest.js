/**
 * Quick self-test for vaultCrypto.js
 * Run with:  node test/cryptoTest.js
 *
 * No test framework needed – just plain Node.js assertions.
 */
'use strict';

const assert = require('assert');
const { isVaultEncrypted, parseHeader, decrypt, encrypt } = require('../src/vaultCrypto');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✓  ${name}`);
        passed++;
    } catch (e) {
        console.error(`  ✗  ${name}`);
        console.error(`     ${e.message}`);
        failed++;
    }
}

// ---------------------------------------------------------------------------
console.log('\nRound-trip tests');
// ---------------------------------------------------------------------------

test('encrypt + decrypt returns original plaintext', () => {
    const plain = 'db_password: supersecret\napi_key: abc123\n';
    const vault = encrypt(plain, 'mypassword');
    const result = decrypt(vault, 'mypassword');
    assert.strictEqual(result, plain);
});

test('round-trip with vault ID (1.2 format)', () => {
    const plain = '---\nsecret: hello\n';
    const vault = encrypt(plain, 'pw', 'dev');
    const result = decrypt(vault, 'pw');
    assert.strictEqual(result, plain);
    assert.ok(vault.startsWith('$ANSIBLE_VAULT;1.2;AES256;dev'));
});

test('each encryption produces a different ciphertext (random salt)', () => {
    const plain  = 'same content';
    const vault1 = encrypt(plain, 'pw');
    const vault2 = encrypt(plain, 'pw');
    assert.notStrictEqual(vault1, vault2);
});

test('wrong password throws', () => {
    const vault = encrypt('secret', 'correct');
    assert.throws(() => decrypt(vault, 'wrong'), /HMAC mismatch/);
});

test('corrupted data throws', () => {
    const vault = encrypt('secret', 'pw');
    const corrupted = vault.replace(/[a-f]/g, 'z');
    assert.throws(() => decrypt(corrupted, 'pw'));
});

// ---------------------------------------------------------------------------
console.log('\nisVaultEncrypted tests');
// ---------------------------------------------------------------------------

test('detects 1.1 vault', () => {
    const v = encrypt('x', 'pw');
    assert.ok(isVaultEncrypted(v));
});

test('detects 1.2 vault', () => {
    const v = encrypt('x', 'pw', 'myid');
    assert.ok(isVaultEncrypted(v));
});

test('rejects plain text', () => {
    assert.ok(!isVaultEncrypted('hello: world'));
});

test('rejects empty string', () => {
    assert.ok(!isVaultEncrypted(''));
});

// ---------------------------------------------------------------------------
console.log('\nparseHeader tests');
// ---------------------------------------------------------------------------

test('parseHeader 1.1', () => {
    const v = encrypt('x', 'pw');
    const h = parseHeader(v);
    assert.strictEqual(h.version, '1.1');
    assert.strictEqual(h.vaultId, null);
});

test('parseHeader 1.2 with vault ID', () => {
    const v = encrypt('x', 'pw', 'prod');
    const h = parseHeader(v);
    assert.strictEqual(h.version, '1.2');
    assert.strictEqual(h.vaultId, 'prod');
});

test('parseHeader returns null for non-vault', () => {
    assert.strictEqual(parseHeader('---\nfoo: bar\n'), null);
});

// ---------------------------------------------------------------------------
console.log('\n');
console.log(`Results: ${passed} passed, ${failed} failed`);
// ---------------------------------------------------------------------------

if (failed > 0) process.exit(1);
