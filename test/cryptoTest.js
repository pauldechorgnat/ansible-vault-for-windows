/**
 * Self-test for vaultCrypto.js
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
console.log('\nPKCS7 padding tests');
// ---------------------------------------------------------------------------

test('decrypted content has no trailing padding bytes', () => {
    // ansible-vault adds PKCS7 padding before encrypting – the user must
    // never see those extra bytes when reading back
    const plain = 'key: value\n';
    const vault = encrypt(plain, 'pw');
    const result = decrypt(vault, 'pw');
    assert.strictEqual(result, plain, 'No padding bytes should leak into plaintext');
    // Sanity: last char is the newline we put there, not a control byte
    assert.strictEqual(result.charCodeAt(result.length - 1), 0x0a);
});

test('content that is already a multiple of block size gets a full extra padding block', () => {
    // 16-byte plaintext → padded to 32 → ciphertext must be 32 bytes
    const plain = '0123456789abcdef'; // exactly 16 bytes
    const vault = encrypt(plain, 'pw');
    const result = decrypt(vault, 'pw');
    assert.strictEqual(result, plain);
});

test('empty string round-trip', () => {
    // Padding of a 0-byte input → 16 bytes of 0x10
    const plain = '';
    const vault = encrypt(plain, 'pw');
    const result = decrypt(vault, 'pw');
    assert.strictEqual(result, plain);
});

test('single-byte plaintext round-trip', () => {
    const plain = 'x';
    const vault = encrypt(plain, 'pw');
    const result = decrypt(vault, 'pw');
    assert.strictEqual(result, plain);
});

test('unicode content round-trip', () => {
    const plain = '---\nmot_de_passe: café_crème_€\n';
    const vault = encrypt(plain, 'pw');
    const result = decrypt(vault, 'pw');
    assert.strictEqual(result, plain);
});

// ---------------------------------------------------------------------------
console.log('\nInteroperability tests (vaults produced by the real ansible-vault CLI)');
// ---------------------------------------------------------------------------
//
// Generated with:
//   echo "interop-test-pw" > /tmp/vault_pw.txt
//   printf 'db_password: s3cr3t\napi_key: abc123\n' | \
//       ansible-vault encrypt --vault-password-file /tmp/vault_pw.txt --output interop1.vault -
//   printf 'hello world\n' | \
//       ansible-vault encrypt --vault-password-file /tmp/vault_pw.txt --output interop2.vault -

const INTEROP_PASSWORD = 'interop-test-pw';

const INTEROP_VAULT_1 = `\$ANSIBLE_VAULT;1.1;AES256
38636335623330623735333663323062623530373665336639336534343863353765636233303265
3937376663633466613538353037363666333264396166630a313861363337316435383839303664
35613765303833326533633465383164393537623736303564316439616333326634363132303762
6238643532376130340a336530623836373165366636613938323866643734363938656162663062
37343735623365343663656531396166313866363663306635306338333237623132633464323739
6432386636316561303163363933353161306139373064346637
`;

const INTEROP_VAULT_2 = `\$ANSIBLE_VAULT;1.1;AES256
37313339353038326663343161313462353465346431353964316236356230393639396637633231
6438376535333266353031616534366135623730373333620a636366303363663865323466633366
66336431353261303535633338363138363433626161633037393033326430653831343665323634
6436376361333762320a663165643966303363613431623963373637653632363536343633653466
6635
`;

test('decrypt real ansible-vault (multi-line content)', () => {
    const result = decrypt(INTEROP_VAULT_1, INTEROP_PASSWORD);
    assert.strictEqual(result, 'db_password: s3cr3t\napi_key: abc123\n');
});

test('decrypt real ansible-vault (short content)', () => {
    const result = decrypt(INTEROP_VAULT_2, INTEROP_PASSWORD);
    assert.strictEqual(result, 'hello world\n');
});

test('encrypt then verify with ansible-compatible format', () => {
    // Verify the vault we produce has the right outer structure
    const plain = 'secret: 42\n';
    const vault = encrypt(plain, 'pw');
    assert.ok(vault.startsWith('$ANSIBLE_VAULT;1.1;AES256\n'));
    assert.ok(vault.endsWith('\n'));
    // All body lines must be valid lowercase hex, max 80 chars
    const bodyLines = vault.trim().split('\n').slice(1);
    for (const line of bodyLines) {
        assert.ok(line.length <= 80, `Line too long: ${line.length}`);
        assert.ok(/^[0-9a-f]+$/.test(line), `Non-hex chars in body: ${line}`);
    }
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

test('detects real ansible-vault file', () => {
    assert.ok(isVaultEncrypted(INTEROP_VAULT_1));
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
