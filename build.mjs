/**
 * build.mjs — Kịch bản Build tự động trên đám mây Vercel (Cách 1).
 * Giữ nguyên 100% mã nguồn gốc trong repo (js/core/*, js/ui-*) để báo cáo giảng viên,
 * nhưng khi Vercel xuất bản ra thư mục dist/ thì tự động:
 *   1) Gộp 17 file JS vào 1 closure khép kín (dist/js/app.min.js), xóa sạch thư mục js/core/ trên web.
 *   2) Đóng gói riêng Web Worker (dist/js/worker/keygen.min.js) và bộ test (dist/tests/suite.min.js).
 *   3) Đổi tên toàn bộ hàm nội bộ bằng AST Terser và mã hóa bảng chuỗi XOR + Base64 (_S[...]).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = '.';
const OUT_DIR = './dist';

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT_DIR, 'js/worker'), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, 'tests'), { recursive: true });

for (const dir of ['assets', 'css', 'vendor']) {
  fs.cpSync(path.join(REPO, dir), path.join(OUT_DIR, dir), { recursive: true });
}
fs.cpSync(path.join(REPO, 'tests/test-theme.css'), path.join(OUT_DIR, 'tests/test-theme.css'));

const SAFE_METHOD_NAMES = [
  'utf8Encode', 'utf8Decode', 'bytesToHex', 'hexToBytes', 'bytesToBase64', 'base64ToBytes', 'base64UrlFromBytes',
  'randomBytes', 'xorBytes', 'concatBytes', 'bytesEqual', 'countDiffBits',
  'bytesToBigInt', 'bigIntToBytes', 'bitLength', 'randomBigIntBits', 'randomBigIntRange', 'formatBigInt',
  'Hasher', 'SBOX', 'INV_SBOX', 'xtime', 'gfMul', 'gfInverse',
  'subBytes', 'invSubBytes', 'shiftRows', 'invShiftRows', 'mixColumns', 'invMixColumns', 'addRoundKey',
  'expandKey', 'encryptBlock', 'decryptBlock',
  'cbcEncryptAsync', 'cbcDecryptAsync', 'ctrCryptAsync', 'pkcs7Pad', 'pkcs7Unpad',
  'ecbEncrypt', 'ecbDecrypt', 'cbcEncrypt', 'cbcDecrypt', 'ctrCrypt', 'incrementCounter',
  'extGcd', 'modInverse', 'modPow', 'isProbablePrime', 'generatePrime', 'keyFromPrimes', 'generateKeyPair',
  'encryptInt', 'decryptInt', 'decryptCRT', 'SMALL_PRIMES',
  'H_LEN', 'mgf1', 'encryptText', 'decryptText', 'maxMessageBytes', 'keyBytes',
  'hmacFactory', 'pbkdf2', 'constantTimeEqual',
  'encryptWithPassword', 'decryptWithPassword', 'encryptForRecipient', 'decryptWithPrivateKey',
  'parseHeader', 'exportPublicKey', 'exportPrivateKey', 'fingerprint', 'DEFAULT_ITERATIONS',
  'aesCbcEncrypt', 'aesCbcDecrypt', 'aesCtr', 'rsaOaepEncrypt', 'rsaOaepDecrypt', 'timeIt',
  'runKeygen', 'refreshKeyUsers', 'hexGroups', 'shortB64', 'columnChart', 'barRows',
  'sessionKey', 'wrappedKey', 'roundKeys', 'isPrivate',
];

const CORE_FILES = [
  'js/core/utils.js',
  'js/core/sha256.js',
  'js/core/aes.js',
  'js/core/modes.js',
  'js/core/rsa.js',
  'js/core/oaep.js',
  'js/core/hybrid.js',
  'js/core/kdf.js',
  'js/core/filecrypt.js',
  'js/lib/webcrypto.js',
];

const UI_FILES = [
  'js/app.js',
  'js/ui-aes.js',
  'js/ui-visual.js',
  'js/ui-more.js',
  'js/ui-app.js',
  'js/ui-shell.js',
  'js/ui-effects.js',
];

function buildMainBundle() {
  const parts = [];
  parts.push(`(function($, window, document, crypto, performance, Worker, Blob, URL, Image, ImageData, TextEncoder, TextDecoder, Uint8Array, Uint32Array, BigInt, Math, Date, JSON, Error, RegExp, Number, String, Object, Array, Promise, setTimeout, setInterval, clearInterval) {`);
  parts.push(`'use strict';`);
  parts.push(`const _V = Object.create(null);`);

  for (const f of CORE_FILES) {
    let src = fs.readFileSync(path.join(REPO, f), 'utf8');
    src = src.replace(/\}\)\(typeof self !== 'undefined' \? self : globalThis\);/, '})(_V);');
    parts.push(src);
  }

  parts.push(`const { CryptoUtils, SHA256, AES, Modes, RSA, OAEP, Hybrid, KDF, FileCrypt, WebCryptoLib } = _V;`);
  parts.push(`let __app_private = null;`);

  for (const f of UI_FILES) {
    let src = fs.readFileSync(path.join(REPO, f), 'utf8');
    src = src.replace(/window\.__app/g, '__app_private');
    src = src.replace(/new Worker\(['"]js\/worker\/rsa-keygen\.worker\.js['"]\)/g, "new Worker('js/worker/keygen.min.js')");
    src = src.replace(/\/\[&<>"'\]\/g/g, '/[&<>\\x22\\x27]/g');
    parts.push(src);
  }

  parts.push(`})(window.jQuery, window, document, window.crypto, window.performance, window.Worker, window.Blob, window.URL, window.Image, window.ImageData, window.TextEncoder, window.TextDecoder, window.Uint8Array, window.Uint32Array, window.BigInt, window.Math, window.Date, window.JSON, window.Error, window.RegExp, window.Number, window.String, window.Object, window.Array, window.Promise, window.setTimeout, window.setInterval, window.clearInterval);`);
  return parts.join('\n');
}

function buildWorkerBundle() {
  const parts = [];
  parts.push(`(function(self, crypto, performance, TextEncoder, TextDecoder, Uint8Array, BigInt, Math, Error, String) {`);
  parts.push(`'use strict';`);
  parts.push(`const _V = Object.create(null);`);
  for (const f of ['js/core/utils.js', 'js/core/rsa.js']) {
    let src = fs.readFileSync(path.join(REPO, f), 'utf8');
    src = src.replace(/\}\)\(typeof self !== 'undefined' \? self : globalThis\);/, '})(_V);');
    parts.push(src);
  }
  parts.push(`const { CryptoUtils, RSA } = _V;`);
  let wSrc = fs.readFileSync(path.join(REPO, 'js/worker/rsa-keygen.worker.js'), 'utf8');
  wSrc = wSrc.replace(/importScripts\([^)]+\);?/g, '');
  parts.push(wSrc);
  parts.push(`})(self, self.crypto, self.performance, self.TextEncoder, self.TextDecoder, self.Uint8Array, self.BigInt, self.Math, self.Error, self.String);`);
  return parts.join('\n');
}

function buildTestBundle() {
  const parts = [];
  parts.push(`(function(window, document, QUnit, crypto, performance) {`);
  parts.push(`'use strict';`);
  parts.push(`const _V = Object.create(null);`);
  parts.push(fs.readFileSync(path.join(REPO, 'tests/test-ui.js'), 'utf8'));
  for (const f of CORE_FILES) {
    let src = fs.readFileSync(path.join(REPO, f), 'utf8');
    src = src.replace(/\}\)\(typeof self !== 'undefined' \? self : globalThis\);/, '})(_V);');
    parts.push(src);
  }
  parts.push(`const { CryptoUtils, SHA256, AES, Modes, RSA, OAEP, Hybrid, KDF, FileCrypt, WebCryptoLib } = _V;`);
  parts.push(fs.readFileSync(path.join(REPO, 'tests/tests.js'), 'utf8'));
  parts.push(`})(window, document, window.QUnit, window.crypto, window.performance);`);
  return parts.join('\n');
}

const MANGLE_REGEX = new RegExp(`^(${[
  'CryptoUtils', 'SHA256', 'AES', 'Modes', 'RSA', 'OAEP', 'Hybrid', 'KDF', 'FileCrypt', 'WebCryptoLib',
  ...SAFE_METHOD_NAMES,
].join('|')})$`);

function obfuscateStringsInMinified(minifiedCode) {
  const strings = [];
  const map = new Map();
  function getIdx(s) {
    if (!map.has(s)) {
      map.set(s, strings.length);
      strings.push(s);
    }
    return map.get(s);
  }

  let out = '';
  let i = 0;
  const n = minifiedCode.length;
  let tplDepth = 0;
  const braceStack = [];

  while (i < n) {
    const ch = minifiedCode[i];
    if (ch === '`') {
      if (tplDepth === 0 || (braceStack.length > 0 && braceStack[braceStack.length - 1] === 'tpl')) {
        if (braceStack.length > 0 && braceStack[braceStack.length - 1] === 'tpl') {
          braceStack.pop();
          tplDepth--;
        } else {
          braceStack.push('tpl');
          tplDepth++;
        }
      }
      out += ch;
      i++;
      while (i < n && braceStack[braceStack.length - 1] === 'tpl') {
        if (minifiedCode[i] === '\\') {
          out += minifiedCode.slice(i, i + 2);
          i += 2;
        } else if (minifiedCode[i] === '$' && minifiedCode[i + 1] === '{') {
          out += '${';
          braceStack.push('expr');
          i += 2;
          break;
        } else if (minifiedCode[i] === '`') {
          out += '`';
          braceStack.pop();
          tplDepth--;
          i++;
          break;
        } else {
          out += minifiedCode[i];
          i++;
        }
      }
      continue;
    }
    if (braceStack.length > 0 && braceStack[braceStack.length - 1] === 'expr') {
      if (ch === '{') {
        braceStack.push('block');
        out += ch;
        i++;
        continue;
      } else if (ch === '}') {
        braceStack.pop();
        out += ch;
        i++;
        while (i < n && braceStack[braceStack.length - 1] === 'tpl') {
          if (minifiedCode[i] === '\\') {
            out += minifiedCode.slice(i, i + 2);
            i += 2;
          } else if (minifiedCode[i] === '$' && minifiedCode[i + 1] === '{') {
            out += '${';
            braceStack.push('expr');
            i += 2;
            break;
          } else if (minifiedCode[i] === '`') {
            out += '`';
            braceStack.pop();
            tplDepth--;
            i++;
            break;
          } else {
            out += minifiedCode[i];
            i++;
          }
        }
        continue;
      }
    } else if (braceStack.length > 0 && braceStack[braceStack.length - 1] === 'block') {
      if (ch === '{') braceStack.push('block');
      else if (ch === '}') braceStack.pop();
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < n && minifiedCode[j] !== '"') {
        if (minifiedCode[j] === '\\') j += 2;
        else j++;
      }
      const rawLiteral = minifiedCode.slice(i, j + 1);
      let k = j + 1;
      while (k < n && /\s/.test(minifiedCode[k])) k++;
      if (rawLiteral === '"use strict"' || minifiedCode[k] === ':') {
        out += rawLiteral;
      } else {
        try {
          const val = JSON.parse(rawLiteral);
          const idx = getIdx(val);
          out += `_S[${idx}]`;
        } catch {
          out += rawLiteral;
        }
      }
      i = j + 1;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < n && minifiedCode[j] !== "'") {
        if (minifiedCode[j] === '\\') j += 2;
        else j++;
      }
      out += minifiedCode.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += ch;
    i++;
  }

  const jsonBytes = Buffer.from(JSON.stringify(strings), 'utf8');
  const xored = Buffer.alloc(jsonBytes.length);
  for (let b = 0; b < jsonBytes.length; b++) xored[b] = jsonBytes[b] ^ 0x5a;
  const b64 = xored.toString('base64');

  const header = `const _S=(()=>{const b=atob("${b64}"),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i)^90;return JSON.parse(new TextDecoder().decode(u))})();`;
  return header + out;
}

function runTerser(args) {
  const localTerser = path.resolve('node_modules/.bin/terser');
  const cmd = fs.existsSync(localTerser) ? localTerser : 'terser';
  execFileSync(cmd, args);
}

function buildAndObfuscate(rawCode, outFile) {
  const s1 = path.join(OUT_DIR, '_s1.js');
  const s2 = path.join(OUT_DIR, '_s2.js');
  const s3 = path.join(OUT_DIR, '_s3.js');
  fs.writeFileSync(s1, rawCode, 'utf8');
  runTerser([
    s1,
    '--compress', 'passes=3,toplevel=true,pure_getters=true',
    '--mangle', 'toplevel=true',
    '--mangle-props', `regex=/${MANGLE_REGEX.source}/`,
    '--format', 'comments=false,ascii_only=true',
    '--output', s2,
  ]);
  const stage2 = fs.readFileSync(s2, 'utf8');
  const stage3 = obfuscateStringsInMinified(stage2);
  fs.writeFileSync(s3, stage3, 'utf8');
  runTerser([
    s3,
    '--compress', 'passes=2,toplevel=true',
    '--mangle', 'toplevel=true',
    '--format', 'comments=false,ascii_only=true',
    '--output', outFile,
  ]);
  fs.rmSync(s1, { force: true });
  fs.rmSync(s2, { force: true });
  fs.rmSync(s3, { force: true });
}

buildAndObfuscate(buildMainBundle(), path.join(OUT_DIR, 'js/app.min.js'));
buildAndObfuscate(buildWorkerBundle(), path.join(OUT_DIR, 'js/worker/keygen.min.js'));
buildAndObfuscate(buildTestBundle(), path.join(OUT_DIR, 'tests/suite.min.js'));

let indexHtml = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
indexHtml = indexHtml.replace(
  /<script src="js\/core\/utils\.js"><\/script>[\s\S]*?<script src="js\/ui-effects\.js"><\/script>/,
  '<script src="js/app.min.js"></script>'
);
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), indexHtml, 'utf8');

let testHtml = fs.readFileSync(path.join(REPO, 'tests/test.html'), 'utf8');
testHtml = testHtml.replace(
  /<script src="test-ui\.js"><\/script>[\s\S]*?<script src="tests\.js"><\/script>/,
  '<script src="suite.min.js"></script>'
);
fs.writeFileSync(path.join(OUT_DIR, 'tests/test.html'), testHtml, 'utf8');

fs.writeFileSync(
  path.join(OUT_DIR, '404.html'),
  `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>403 Forbidden</title></head><body style="background:#070d19;color:#e9f2ff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>403 — Truy cập trực tiếp mã nguồn bị từ chối</h2><p>Chỉ cho phép thực thi ứng dụng qua giao diện chính.</p></div></body></html>`,
  'utf8'
);

console.log('Successfully built ./dist for Vercel deployment!');
