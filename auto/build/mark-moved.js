#!/usr/bin/env node
/*
 * mark-moved.js
 * 管理画面へ移したページ（moved-pages.json）の入口（パスワードの画面）に、
 * 暗号化しない「このページは管理画面へ移動しました」の帯を出す。中身（暗号文）は消さない。
 * 何度流しても同じ（帯は <!--moved-banner--> の印で置き換える）。
 *
 * 使い方: node auto/build/mark-moved.js   （リポジトリの直下で）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const moved = JSON.parse(fs.readFileSync(path.join(__dirname, 'moved-pages.json'), 'utf8'));

const START = '<!--moved-banner-->';
const END = '<!--/moved-banner-->';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

for (const [file, info] of Object.entries(moved)) {
  if (file.startsWith('_')) continue;
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) { console.warn('[skip] not found:', file); continue; }
  let html = fs.readFileSync(p, 'utf8');
  const banner = `${START}<div style="position:sticky;top:0;z-index:10;background:#fff7e6;border-bottom:1px solid #f5c26b;color:#7a4b00;padding:12px 16px;font-size:14px;line-height:1.6;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Noto Sans JP',sans-serif">このページは ${esc(info.movedOn)} に管理画面へ移動しました（${esc(info.where)}）。最新はこちら → <a href="${esc(info.url)}" style="color:#1e46aa;font-weight:700">${esc(info.url)}</a><br><span style="font-size:12px;color:#9a6a1a">このページは更新を止めています。パスワードで開くと、移動した日までの内容を見られます。</span></div>${END}`;
  const re = new RegExp(`${START}[\\s\\S]*?${END}`);
  if (re.test(html)) {
    html = html.replace(re, () => banner);
  } else if (/<body[^>]*>/.test(html)) {
    html = html.replace(/<body[^>]*>/, (m) => `${m}\n${banner}`);
  } else {
    console.warn('[skip] no <body>:', file);
    continue;
  }
  fs.writeFileSync(p, html);
  console.log('[ok]', file);
}
