#!/usr/bin/env node
/*
 * encrypt-wrap.js
 * 内側ダッシュボードHTML（平文）を AES-256-GCM で暗号化し、
 * パスワード入力→復号して表示する自己完結HTMLとして出力する。
 * パスワードを複数渡すと、同じ内容をそれぞれ別鍵で暗号化して埋め込み、
 * どのパスワードでも同じページを開けるようにする
 *（例：社外専用パスワードと、社内共通パスワードの両方で開ける、など）。
 *
 * 復号は閲覧者ブラウザ内（WebCrypto）でのみ行われる。サーバには平文は載らない。
 * WebCrypto互換のため: PBKDF2(SHA-256) でキー導出、暗号文は ciphertext||authTag。
 *
 * 使い方:
 *   node encrypt-wrap.js <inner.html> <out.html> <password> "<title>" [password2] [password3...]
 */
const fs = require('fs');
const crypto = require('crypto');

const [,, innerPath, outPath, password, pageTitle, ...extraPasswords] = process.argv;
if (!innerPath || !outPath || !password) {
  console.error('usage: node encrypt-wrap.js <inner.html> <out.html> <password> "<title>" [password2...]');
  process.exit(1);
}

const ITERS = 250000;
const plaintext = fs.readFileSync(innerPath);
const passwords = [password, ...extraPasswords].filter(Boolean);

const b64 = b => b.toString('base64');
const slots = passwords.map(pw => {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(Buffer.from(pw, 'utf8'), salt, ITERS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([enc, tag]); // WebCrypto互換: ciphertext + 16byte tag
  return { salt: b64(salt), iv: b64(iv), payload: b64(payload) };
});

const title = pageTitle || 'ダッシュボード（要パスワード）';

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>
  :root{ color-scheme: light; font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP","Segoe UI",sans-serif; }
  *{ box-sizing:border-box; }
  body{ margin:0; min-height:100vh; background:#f4f6fb; color:#1a1d21; }
  .gate{ min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card{ background:#fff; border:1px solid #e6e8eb; border-radius:16px; box-shadow:0 8px 30px rgba(30,70,170,.12);
    padding:30px 28px; width:100%; max-width:380px; }
  .card h1{ font-size:18px; margin:0 0 6px; color:#1e46aa; }
  .card p{ font-size:12.5px; color:#6b7280; margin:0 0 18px; line-height:1.6; }
  .card label{ font-size:12px; color:#374151; font-weight:600; display:block; margin-bottom:6px; }
  .card input{ width:100%; padding:11px 13px; font-size:15px; border:1px solid #cdddf8; border-radius:10px; outline:none; }
  .card input:focus{ border-color:#285ac8; box-shadow:0 0 0 3px rgba(40,90,200,.12); }
  .card button{ width:100%; margin-top:14px; padding:11px; font-size:14px; font-weight:700; color:#fff;
    background:#285ac8; border:0; border-radius:10px; cursor:pointer; }
  .card button:disabled{ opacity:.6; cursor:default; }
  .err{ color:#dc2626; font-size:12.5px; margin-top:12px; min-height:16px; }
  .meta{ color:#9aa3b2; font-size:11px; margin-top:16px; }
</style>
</head>
<body>
<div class="gate" id="gate">
  <form class="card" id="f" autocomplete="off">
    <h1>${title}</h1>
    <p>このページは暗号化されています。閲覧にはパスワードが必要です。</p>
    <label for="pw">パスワード</label>
    <input type="password" id="pw" autocomplete="current-password" autofocus>
    <button type="submit" id="btn">表示する</button>
    <div class="err" id="err"></div>
    <div class="meta">復号は端末内でのみ行われます（サーバに平文は送信されません）。</div>
  </form>
</div>
<script>
const ITERS=${ITERS};
const SLOTS=${JSON.stringify(slots)};
function b2u(s){ const b=atob(s); const u=new Uint8Array(b.length); for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i); return u; }
async function tryDecrypt(pw, slot){
  const enc=new TextEncoder();
  const km=await crypto.subtle.importKey("raw",enc.encode(pw),"PBKDF2",false,["deriveKey"]);
  const key=await crypto.subtle.deriveKey({name:"PBKDF2",salt:b2u(slot.salt),iterations:ITERS,hash:"SHA-256"},km,{name:"AES-GCM",length:256},false,["decrypt"]);
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:b2u(slot.iv)},key,b2u(slot.payload));
  return new TextDecoder().decode(plain);
}
async function unlock(pw){
  for(const slot of SLOTS){
    try{ return await tryDecrypt(pw, slot); }catch(_e){ /* このパスワードでは開かない枠。次を試す */ }
  }
  throw new Error("no matching slot");
}
document.getElementById("f").addEventListener("submit",async e=>{
  e.preventDefault();
  const btn=document.getElementById("btn"), err=document.getElementById("err");
  err.textContent=""; btn.disabled=true; btn.textContent="復号中…";
  try{
    const html=await unlock(document.getElementById("pw").value);
    document.open(); document.write(html); document.close();
  }catch(ex){
    err.textContent="パスワードが違います。"; btn.disabled=false; btn.textContent="表示する";
  }
});
</script>
</body>
</html>`;

fs.writeFileSync(outPath, html);
console.log('wrote', outPath, '(', html.length, 'bytes,', slots.length, 'password slot(s) )');
