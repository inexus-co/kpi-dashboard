#!/usr/bin/env python3
"""
競合アプリ定点観測ダッシュボード ビルダー
使い方:
    python3 competitor-dashboard-builder.py <slack_dump_path> [out_html_path]

<slack_dump_path>: Slack #op-app-review-monitoring を読み込んだ結果ファイル。
  - {"messages": "...(=== Message from ... 形式の本文)..."} という JSON、または
  - その本文テキストを連結したプレーンテキスト（複数回読み込んだ場合は連結でOK）
出力: 自己完結HTML（既定: 同ディレクトリの competitor-dashboard.html）

Slack の各投稿末尾にある `_状態: ..._` 行を一次ソースとして時系列を再構築する。
過去の全投稿を読み込むほど期間（1週間/1ヶ月/半年タブ）が埋まる。
"""
import json, re, sys, os

# ---- 静的メタ（区分・自社フラグ・料金・補足。バージョンはSlackから上書き）----
META = {
 "採点くん":{"cat":"採点系","own":True,"ver":"v2.2.0","price":"無料","note":"自社・小学生/宿題チェック特化"},
 "Knock":{"cat":"採点系","own":False,"ver":"-","price":"無料+Plus ¥980/月","note":"中高生AIチューター。30万DL・1,000万回答超(PR TIMES)"},
 "宿題スキャナー":{"cat":"採点系","own":False,"ver":"-","price":"無料(一部有料)","note":"シュクスキャ。GPT-5搭載"},
 "QANDA":{"cat":"採点系","own":False,"ver":"-","price":"無料+¥1,700/月","note":"広告・無料制限に不満傾向"},
 "Photomath":{"cat":"採点系","own":False,"ver":"-","price":"無料+Plus","note":"Google傘下・グローバル1億DL超(件数はJP値)"},
 "英語宿題スキャナー":{"cat":"採点系","own":False,"ver":"-","price":"無料+サブスク","note":"件数極少"},
 "まなんでパズル":{"cat":"知育系","own":True,"ver":"v1.3.3","price":"無料","note":"自社。Android ★3.0/15件"},
 "Springin'":{"cat":"知育系","own":False,"ver":"-","price":"無料","note":"Kids Game Creator Contest 開催中(〜7/31)"},
 "プログラミングゼミ":{"cat":"知育系","own":False,"ver":"-","price":"無料(DeNA)","note":"渋谷区モデル採用"},
 "Viscuit":{"cat":"知育系","own":False,"ver":"-","price":"無料+¥500/月","note":"ファシリテーター講座"},
 "ScratchJr":{"cat":"知育系","own":False,"ver":"-","price":"無料","note":"日本語含む5言語追加で国内浸透"},
 "embot":{"cat":"知育系","own":False,"ver":"-","price":"本体有料+アプリ無料","note":"ハードウェア連携型"},
}
ALIASES = {
 'シュクスキャ':'宿題スキャナー','宿題スキャナー':'宿題スキャナー',
 '英宿スキャナー':'英語宿題スキャナー','英語宿題スキャナー':'英語宿題スキャナー',
 'Knock':'Knock','QANDA':'QANDA','Qanda':'QANDA','Photomath':'Photomath',
 'プロゼミ':'プログラミングゼミ','プログラミングゼミ':'プログラミングゼミ',
 "Springin'":"Springin'",'Springin':"Springin'",
 'ScratchJr':'ScratchJr','Viscuit':'Viscuit','embot':'embot',
}

def load_text(path):
    raw = open(path, encoding='utf-8').read()
    try:
        return json.loads(raw)['messages']
    except Exception:
        return raw

def parse(path):
    m = load_text(path)
    parts = m.split('=== Message from')[1:]
    blocks = []
    for p in parts:
        d = re.search(r'at (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) JST', p)
        if not d: continue
        blocks.append({'date': d.group(1), 'time': d.group(2), 'text': p})

    comp = {}
    for b in blocks:
        if '競合アプリ定点観測' not in b['text']: continue
        st = re.search(r'_状態: (.+?)_(?:\n|$)', b['text'])
        if not st: continue
        for ent in re.findall(r'([^,]+?)★([\d.]+)/([\d,]+)', st.group(1)):
            raw, star, cnt = ent
            app = next((ALIASES[k] for k in ALIASES if k in raw), None)
            if not app: continue
            ver = re.search(r'(v[\d.]+)', raw)
            comp.setdefault(app, []).append({'date': b['date'], 'star': float(star),
                'count': int(cnt.replace(',', '')), 'ver': ver.group(1) if ver else None})

    own = {'採点くんiOS': [], 'まなんでパズルiOS': [], 'まなんでパズルAndroid': []}
    for b in blocks:
        if 'ストア公開レビュー監視' not in b['text']: continue
        st = re.search(r'_状態: (.+?)_(?:\n|$)', b['text'])
        if not st: continue
        line = st.group(1)
        mi = re.search(r'採点くんiOS ★([\d.]+)/(\d+)件', line)
        if mi: own['採点くんiOS'].append({'date': b['date'], 'star': float(mi.group(1)), 'count': int(mi.group(2))})
        mp = re.search(r'まなパズiOS ★([\d.]+)/(\d+)件', line)
        if mp: own['まなんでパズルiOS'].append({'date': b['date'], 'star': float(mp.group(1)), 'count': int(mp.group(2))})
        ma = re.search(r'まなパズAndroid ★([\d.]+)/(\d+)', line)
        if ma: own['まなんでパズルAndroid'].append({'date': b['date'], 'star': float(ma.group(1)), 'count': int(ma.group(2))})

    def dedupe(lst):  # blocks are newest-first => first seen per date is latest
        seen = {}
        for r in lst: seen.setdefault(r['date'], r)
        return sorted(seen.values(), key=lambda x: x['date'])

    series = {}
    for a, v in comp.items():
        series[a] = dedupe(v)
        # latest version into META
        vers = [r['ver'] for r in series[a] if r.get('ver')]
        if vers: META[a]['ver'] = vers[-1]
    series['採点くん'] = dedupe(own['採点くんiOS'])
    series['まなんでパズル'] = dedupe(own['まなんでパズルiOS'])
    mana_android = dedupe(own['まなんでパズルAndroid'])

    # ---- レビュー抽出（日次投稿を新しい順に走査して best-effort）----
    reviews = {
        '採点くん': {'themes_neg': [], 'themes_pos': [], 'new': [], 'list': []},
        'まなんでパズル': {'themes_neg': [], 'themes_pos': [], 'new': [], 'list': []},
    }
    daily = [b for b in blocks if 'ストア公開レビュー監視' in b['text']]  # newest-first
    APPHDR = {'採点くん': '採点くん', 'まなんでパズル': 'まなんでパズル'}
    for app, hdr in APPHDR.items():
        for b in daily:
            t = b['text']
            # この投稿を採点くん/まなパズのセクションに分割
            idx = t.find('*' + hdr + '*')
            if idx < 0:
                idx = t.find(hdr)
            if idx < 0: continue
            # 次のアプリ見出し or 状態行まで
            nxt = len(t)
            for other in APPHDR.values():
                if other == hdr: continue
                j = t.find('*' + other + '*', idx + 1)
                if 0 < j < nxt: nxt = j
            j = t.find('_状態:', idx)
            if 0 < j < nxt: nxt = j
            sec = t[idx:nxt]
            r = reviews[app]
            def split_th(s):
                s = re.sub(r'（.+?）', '', s).strip()
                return [x.strip() for x in re.split(r'[・/、]', s) if x.strip()]
            def weak(lst):  # 中身が「特になし」系のみなら弱い
                return (not lst) or all(re.search(r'特になし|なし$', x) for x in lst)
            mt = re.search(r'不満の主因[:：]\s*(.+?)[\s　]*/\s*好評の主因[:：]\s*(.+)', sec)
            if mt:
                neg, pos = split_th(mt.group(1)), split_th(mt.group(2))
                # 実質的なテーマを優先。弱いものは fallback として保持
                if weak(r['themes_neg']) and not weak(neg): r['themes_neg'] = neg
                elif not r['themes_neg']: r['themes_neg'] = neg
                if weak(r['themes_pos']) and not weak(pos): r['themes_pos'] = pos
                elif not r['themes_pos']: r['themes_pos'] = pos
            if not r['new']:
                for nm in re.finditer(r'新規(\d+)件\s*★(\d)「(.+?)」', sec):
                    r['new'].append({'star': int(nm.group(2)), 'text': nm.group(3), 'date': '直近の新規'})
            if not r['list']:
                lst = re.findall(r'★(\d)「(.+?)」（([\d-]+)）', sec)
                if lst:
                    r['list'] = [{'star': int(s), 'text': tx, 'date': dt} for s, tx, dt in lst]
            if (not weak(r['themes_pos'])) and (not weak(r['themes_neg'])) and r['list']: break

    return {'series': series, 'meta': META, 'reviews': reviews,
            'manapuzuAndroid': mana_android}

def build(data, out_path):
    # 期間ラベル
    all_dates = sorted({p['date'] for s in data['series'].values() for p in s})
    updated = all_dates[-1] if all_dates else '-'
    data['period'] = (all_dates[0] + ' 〜 ' + all_dates[-1]) if all_dates else '-'
    data['updated'] = updated
    DATA = json.dumps(data, ensure_ascii=False)
    html = TEMPLATE.replace('__DATA__', DATA)
    open(out_path, 'w', encoding='utf-8').write(html)
    return len(html)

TEMPLATE = r'''<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>競合アプリ 定点観測ダッシュボード</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.js" integrity="sha384-iU8HYtnGQ8Cy4zl7gbNMOhsDTTKX02BTXptVP/vqAWIaTfM7isw76iyZCsjL2eVi" crossorigin="anonymous"></script>
<style>
:root{color-scheme:light;
 --bg:#f6f7f9; --card:#ffffff; --ink:#161d2b; --muted:#6c7689; --line:#e6e9ef;
 --own:#2563eb; --score:#f59e0b; --edu:#16a34a; --red:#e11d48; --soft:#f1f4f9;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
 font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",Meiryo,sans-serif;
 font-size:14px;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:28px 20px 64px}
header.top{margin-bottom:18px}
.eyebrow{font-size:12px;letter-spacing:.08em;color:var(--muted);font-weight:600}
h1{font-size:23px;margin:4px 0 6px;font-weight:700;letter-spacing:.01em}
.sub{color:var(--muted);font-size:13px}
.sub b{color:var(--ink);font-weight:600}
.tabbar{display:flex;align-items:center;gap:10px;margin:16px 0 4px;flex-wrap:wrap}
.tabs{display:inline-flex;background:#eceef2;border-radius:11px;padding:4px;gap:2px}
.tabs button{border:0;background:transparent;color:var(--muted);font-weight:600;font-size:13px;
 padding:7px 18px;border-radius:8px;cursor:pointer;font-family:inherit;transition:.15s}
.tabs button:hover{color:var(--ink)}
.tabs button.active{background:#fff;color:var(--own);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.coverage{font-size:11.5px;color:var(--muted)}
.coverage b{color:var(--ink);font-weight:600}
.sec{margin-top:30px}
.sec-h{display:flex;align-items:baseline;gap:10px;margin-bottom:14px}
.sec-h h2{font-size:16px;margin:0;font-weight:700}
.sec-h .tag{font-size:11px;color:var(--muted)}
.grid{display:grid;gap:14px}
.k4{grid-template-columns:repeat(4,1fr)}
.k2{grid-template-columns:repeat(2,1fr)}
@media(max-width:780px){.k4{grid-template-columns:repeat(2,1fr)}.k2{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 16px}
.kpi .lbl{font-size:12px;color:var(--muted);font-weight:600;display:flex;align-items:center;gap:6px}
.kpi .big{font-size:26px;font-weight:750;margin:7px 0 2px;letter-spacing:-.01em}
.kpi .big .u{font-size:13px;font-weight:600;color:var(--muted);margin-left:3px}
.kpi .meta{font-size:12px;color:var(--muted)}
.kpi.own{border-color:#c7d6fb;background:linear-gradient(180deg,#f5f8ff,#ffffff)}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.up{color:var(--red);font-weight:700}
.flat{color:var(--muted)}
.chart-box{position:relative;height:300px}
.chart-box.sm{height:260px}
.note{font-size:12.5px;color:var(--muted);margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)}
.note b{color:var(--ink)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:right;padding:9px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
th:first-child,td:first-child{text-align:left}
th{font-size:11px;color:var(--muted);font-weight:600;background:var(--soft)}
tbody tr.own td{background:#f5f8ff;font-weight:600}
.chip{display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;font-weight:600}
.chip.score{background:#fff3e0;color:#b45309}
.chip.edu{background:#e7f6ec;color:#15803d}
.chip.ownb{background:#e5edff;color:#1d4ed8}
.appname{font-weight:600}
.appname .me{font-size:10px;color:var(--own);font-weight:700;margin-left:5px}
.rev{display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);align-items:flex-start}
.rev:last-child{border-bottom:none}
.stars{font-size:12px;font-weight:700;white-space:nowrap;min-width:42px}
.s-hi{color:#16a34a}.s-mid{color:#f59e0b}.s-lo{color:#e11d48}
.rev .txt{flex:1}.rev .dt{font-size:11px;color:var(--muted);white-space:nowrap}
.rev.newr{background:#fffbeb;border-radius:8px;padding:9px 10px;border-bottom:none;margin-bottom:4px}
.newbadge{font-size:10px;background:#f59e0b;color:#fff;padding:1px 7px;border-radius:999px;font-weight:700;margin-left:6px}
.themes{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 2px}
.t-pos{background:#e7f6ec;color:#15803d;font-size:11px;padding:3px 9px;border-radius:999px;font-weight:600}
.t-neg{background:#fdecef;color:#be123c;font-size:11px;padding:3px 9px;border-radius:999px;font-weight:600}
.app-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
.app-head .nm{font-size:15px;font-weight:700}
.app-head .rt{font-size:13px;color:var(--muted)}
.lab{font-size:11px;color:var(--muted);font-weight:600;margin:12px 0 2px}
footer{margin-top:34px;font-size:11.5px;color:var(--muted);border-top:1px solid var(--line);padding-top:14px;line-height:1.7}
</style>
</head>
<body>
<div class="wrap">
<header class="top">
 <div class="eyebrow">#op-app-review-monitoring ・ 株式会社インネクサス</div>
 <h1>競合アプリ 定点観測ダッシュボード</h1>
 <div class="sub">最終更新 <b id="updated"></b>　|　iOS App Store（JP, iTunes API）ベース</div>
 <div class="tabbar">
  <div class="tabs" id="tabs">
   <button data-d="7" class="active">1週間</button>
   <button data-d="31">1ヶ月</button>
   <button data-d="183">半年</button>
  </div>
  <div class="coverage" id="coverage"></div>
 </div>
</header>
<section class="sec">
 <div class="sec-h"><h2>ハイライト</h2><span class="tag" id="hlTag"></span></div>
 <div class="grid k4" id="kpis"></div>
</section>
<section class="sec">
 <div class="sec-h"><h2>採点系</h2><span class="tag" id="scoreTag"></span></div>
 <div class="card"><div class="chart-box"><canvas id="scoreChart"></canvas></div><div class="note" id="scoreNote"></div></div>
</section>
<section class="sec">
 <div class="sec-h"><h2>知育・パズル系</h2><span class="tag" id="eduTag"></span></div>
 <div class="card"><div class="chart-box"><canvas id="eduChart"></canvas></div><div class="note" id="eduNote"></div></div>
</section>
<section class="sec">
 <div class="grid k2">
  <div class="card"><div class="sec-h"><h2>件数モメンタム</h2><span class="tag">週換算ペース（件/週）</span></div><div class="chart-box sm"><canvas id="paceChart"></canvas></div></div>
  <div class="card"><div class="sec-h"><h2>★評価の比較</h2><span class="tag">現在値</span></div><div class="chart-box sm"><canvas id="starChart"></canvas></div></div>
 </div>
</section>
<section class="sec">
 <div class="sec-h"><h2>自社アプリ詳細</h2><span class="tag">★・件数・新規レビュー</span></div>
 <div class="grid k2" id="ownDetail"></div>
</section>
<section class="sec">
 <div class="sec-h"><h2>全アプリ一覧</h2><span class="tag" id="tblTag"></span></div>
 <div class="card" style="padding:6px 6px;overflow-x:auto">
  <table id="tbl"><thead><tr><th>アプリ</th><th>区分</th><th>★</th><th>件数</th><th>期間増</th><th>週換算</th><th>バージョン</th><th>料金</th></tr></thead><tbody></tbody></table>
 </div>
</section>
<footer>
 <b>データソース:</b> Slack #op-app-review-monitoring の日次／週次自動投稿（iTunes Lookup/Search API・country=jp・コード実行＋WebSearch）。本ダッシュボードはスケジュール実行で自動再生成されます。<br>
 <b>期間タブ:</b> 観測開始は 2026-06-08。競合のクリーンな時系列は計測方式が安定した 2026-06-10 以降。データが蓄積されるほど1ヶ月・半年タブのグラフが伸びていきます。<br>
 <b>注意:</b> Android／Google Play は JS描画のため件数取得不可（まなんでパズル Android ★3.0/15件は既知の固定値）。Photomath の件数はグローバルではなく JPストア値。レビュー本文は App Store RSS の公開分。
</footer>
</div>
<script>
const DATA = __DATA__;
document.getElementById('updated').textContent = DATA.updated;
const COLORS = {"採点くん":"#2563eb","Knock":"#e11d48","宿題スキャナー":"#f59e0b","QANDA":"#0d9488","Photomath":"#7c3aed","英語宿題スキャナー":"#94a3b8","まなんでパズル":"#2563eb","ScratchJr":"#e11d48","プログラミングゼミ":"#f59e0b","Springin'":"#0d9488","Viscuit":"#7c3aed","embot":"#94a3b8"};
const SCORE=["採点くん","Knock","宿題スキャナー","QANDA","Photomath","英語宿題スキャナー"];
const EDU=["まなんでパズル","ScratchJr","プログラミングゼミ","Springin'","Viscuit","embot"];
const DASHED=new Set(["QANDA","Photomath","Viscuit","embot","Springin'","英語宿題スキャナー","プログラミングゼミ"]);
const fmtD=d=>d.slice(5);
const present=a=>DATA.series[a]&&DATA.series[a].length>0;
const SCOREP=SCORE.filter(present), EDUP=EDU.filter(present);
const ALLDATES=[...new Set(Object.values(DATA.series).flat().map(p=>p.date))].sort();
const END=ALLDATES[ALLDATES.length-1], OBS_START=ALLDATES[0];
function addDays(iso,n){const d=new Date(iso+'T00:00:00');d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);}
function ptAt(a,d){const p=DATA.series[a].find(x=>x.date===d);return p?p.count:null;}
function baseAt(a,s){const x=DATA.series[a].filter(p=>p.date>=s);return x.length?x[0]:null;}
function lastPt(a){const s=DATA.series[a];return s[s.length-1];}
function gain(a,s){const b=baseAt(a,s),l=lastPt(a);return(b&&l)?l.count-b.count:0;}
function pace(a,s){const b=baseAt(a,s),l=lastPt(a);if(!b||!l)return 0;const d=(new Date(l.date)-new Date(b.date))/864e5;return d>0?Math.round((l.count-b.count)/d*7):0;}
function cum(a,WIN,s){const b=baseAt(a,s);if(!b)return WIN.map(_=>null);return WIN.map(d=>{const c=ptAt(a,d);return c==null?null:c-b.count;});}
let charts={};
function mkLine(id,apps,WIN,s){if(charts[id])charts[id].destroy();
 const ds=apps.map(a=>({label:a+(DATA.meta[a].own?" ★自社":""),data:cum(a,WIN,s),borderColor:COLORS[a],backgroundColor:COLORS[a],borderWidth:DATA.meta[a].own?3.5:2,tension:.3,pointRadius:DATA.meta[a].own?3:2,pointHoverRadius:5,borderDash:DATA.meta[a].own?[]:(DASHED.has(a)?[5,4]:[]),spanGaps:true}));
 charts[id]=new Chart(document.getElementById(id),{type:'line',data:{labels:WIN.map(fmtD),datasets:ds},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom',labels:{boxWidth:12,font:{size:11},padding:12,usePointStyle:true}},tooltip:{callbacks:{label:c=>`${c.dataset.label.replace(' ★自社','')}: +${c.parsed.y}件`}}},scales:{y:{title:{display:true,text:'累積新規レビュー（件）',font:{size:11}},grid:{color:'#eef1f5'}},x:{grid:{display:false}}}}});}
function render(days){
 const start=addDays(END,-days+1);const WIN=ALLDATES.filter(d=>d>=start);
 const periodLbl=days===7?'直近1週間':days===31?'直近1ヶ月':'直近半年';
 const tagTxt=`${periodLbl} ・ ${WIN[0]}起点の累積新規レビュー`;
 document.getElementById('scoreTag').textContent='採点くんの戦場 ・ '+tagTxt;
 document.getElementById('eduTag').textContent='まなんでパズルの戦場 ・ '+tagTxt;
 document.getElementById('hlTag').textContent=periodLbl+' のレビュー件数の伸び';
 document.getElementById('tblTag').textContent=periodLbl+'・現在値とモメンタム';
 document.getElementById('coverage').innerHTML=`観測開始 <b>${OBS_START}</b> ・ この期間のデータ点 <b>${WIN.length}日分</b>（毎日蓄積）`;
 mkLine('scoreChart',SCOREP,WIN,start);mkLine('eduChart',EDUP,WIN,start);
 const movers=Object.keys(DATA.series).filter(a=>!DATA.meta[a].own&&present(a)).map(a=>({a,g:gain(a,start),w:pace(a,start)})).sort((x,y)=>y.w-x.w);
 function kCard(o){return `<div class="card kpi ${o.own?'own':''}"><div class="lbl"><span class="dot" style="background:${o.color}"></span>${o.lbl}</div><div class="big">${o.big}<span class="u">${o.u||''}</span></div><div class="meta">${o.meta}</div></div>`;}
 let c='';
 if(movers[0])c+=kCard({color:COLORS[movers[0].a],lbl:movers[0].a,big:'+'+movers[0].g,u:'件 / 期間',meta:`週換算 <span class="up">+${movers[0].w}件/週</span> ・ 採点系で最速`});
 if(movers[1])c+=kCard({color:COLORS[movers[1].a],lbl:movers[1].a,big:'+'+movers[1].g,u:'件 / 期間',meta:`週換算 <span class="up">+${movers[1].w}件/週</span> ・ 安定増`});
 const sk=lastPt('採点くん');const skNew=(DATA.reviews['採点くん'].new[0]||{});
 c+=kCard({own:true,color:COLORS['採点くん'],lbl:'採点くん（自社）',big:'★'+sk.star,u:'/ '+sk.count+'件',meta:`期間増 <span class="flat">+${gain('採点くん',start)}件</span>${skNew.star?` ・ 新規★${skNew.star}`:''}`});
 const mp=lastPt('まなんでパズル');const mpNew=(DATA.reviews['まなんでパズル'].new[0]||{});
 c+=kCard({own:true,color:COLORS['まなんでパズル'],lbl:'まなんでパズル（自社）',big:'★'+mp.star,u:'/ '+mp.count+'件',meta:`知育系で★首位級${mpNew.star?` ・ 新規★${mpNew.star}`:''}`});
 document.getElementById('kpis').innerHTML=c;
 const k=movers.find(x=>x.a==='Knock'),sc=movers.find(x=>x.a==='宿題スキャナー');
 document.getElementById('scoreNote').innerHTML=`${k?`<b>Knock</b> が期間 +${k.g}件（週換算 +${k.w}件）で突出、`:''}${sc?`<b>宿題スキャナー（シュクスキャ）</b> が +${sc.g}件で続く。`:''} QANDA・Photomath はほぼ横ばい。<b>採点くん</b>は件数 ${sk.count}件で推移。小学生・宿題チェック特化の差別化を明確化する局面。`;
 const sj=movers.find(x=>x.a==='ScratchJr');
 document.getElementById('eduNote').innerHTML=`知育・パズル系は全体的に静観。${sj?`動いたのは <b>ScratchJr</b>（+${sj.g}件、日本語含む5言語追加で国内浸透）が中心。`:''} <b>まなんでパズル</b>（★${mp.star}）はカテゴリ内で★首位級を維持。`;
 const paceApps=Object.keys(DATA.series).filter(a=>present(a)&&(pace(a,start)>0||DATA.meta[a].own)).map(a=>({a,w:pace(a,start)})).sort((x,y)=>y.w-x.w);
 if(charts.pace)charts.pace.destroy();
 charts.pace=new Chart(document.getElementById('paceChart'),{type:'bar',data:{labels:paceApps.map(o=>o.a+(DATA.meta[o.a].own?' ★':'')),datasets:[{data:paceApps.map(o=>o.w),backgroundColor:paceApps.map(o=>DATA.meta[o.a].own?'#2563eb':COLORS[o.a]+'cc'),borderRadius:5,barThickness:16}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`+${c.parsed.x}件/週`}}},scales:{x:{title:{display:true,text:'件/週',font:{size:11}},grid:{color:'#eef1f5'}},y:{grid:{display:false},ticks:{font:{size:11}}}}}});
 const tb=document.querySelector('#tbl tbody');tb.innerHTML='';
 [...SCOREP,...EDUP].forEach(a=>{const m=DATA.meta[a];const lp=lastPt(a);const g=gain(a,start);const w=pace(a,start);const tr=document.createElement('tr');if(m.own)tr.className='own';
  tr.innerHTML=`<td class="appname">${a}${m.own?'<span class="me">自社</span>':''}</td><td><span class="chip ${m.cat==='採点系'?'score':'edu'}">${m.cat}</span></td><td>★${lp.star}</td><td>${lp.count.toLocaleString()}</td><td class="${g>0?'up':'flat'}">${g>0?'+'+g:'±0'}</td><td class="${w>0?'up':'flat'}">${w>0?'+'+w:'±0'}</td><td>${m.ver}</td><td style="text-align:left;font-size:11px;color:var(--muted)">${m.price}</td>`;tb.appendChild(tr);});
}
function starChart(){const apps=[...SCOREP,...EDUP];
 new Chart(document.getElementById('starChart'),{type:'bar',data:{labels:apps.map(a=>a+(DATA.meta[a].own?' ★':'')),datasets:[{data:apps.map(a=>lastPt(a).star),backgroundColor:apps.map(a=>DATA.meta[a].own?'#2563eb':(DATA.meta[a].cat==='採点系'?'#f59e0bcc':'#16a34acc')),borderRadius:5,barThickness:13}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`★${c.parsed.x}`}}},scales:{x:{min:3,max:5,grid:{color:'#eef1f5'},ticks:{stepSize:0.5}},y:{grid:{display:false},ticks:{font:{size:10}}}}}});}
function ownDetail(){
 function sc(s){return s>=4.5?'s-hi':s>=3.5?'s-mid':'s-lo';}
 function ss(n){return '★'.repeat(n)+'☆'.repeat(5-n);}
 function row(r,nw){return `<div class="rev ${nw?'newr':''}"><div class="stars ${sc(r.star)}">${ss(r.star)}</div><div class="txt">${r.text}${nw?'<span class="newbadge">新規</span>':''}</div><div class="dt">${r.date}</div></div>`;}
 const el=document.getElementById('ownDetail');el.innerHTML='';
 ['採点くん','まなんでパズル'].forEach(app=>{const rv=DATA.reviews[app];const lp=lastPt(app);const extra=app==='まなんでパズル'?' ・ Android ★3.0/15件':'';
  el.insertAdjacentHTML('beforeend',`<div class="card"><div class="app-head"><div class="nm">${app} <span class="chip ownb">自社</span></div><div class="rt">★${lp.star} / ${lp.count}件 ・ ${DATA.meta[app].ver}${extra}</div></div>
   <div class="lab">好評の主因</div><div class="themes">${(rv.themes_pos.length?rv.themes_pos:['—']).map(t=>`<span class="t-pos">${t}</span>`).join('')}</div>
   <div class="lab">不満の主因</div><div class="themes">${(rv.themes_neg.length?rv.themes_neg:['—']).map(t=>`<span class="t-neg">${t}</span>`).join('')}</div>
   ${rv.new.length?`<div class="lab">期間内の新規レビュー</div>${rv.new.map(r=>row(r,true)).join('')}`:''}
   ${rv.list.length?`<div class="lab">最近のレビュー</div>${rv.list.map(r=>row(r,false)).join('')}`:''}</div>`);});}
starChart();ownDetail();render(7);
document.getElementById('tabs').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;document.querySelectorAll('#tabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');render(parseInt(b.dataset.d,10));});
</script>
</body>
</html>'''

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'competitor-dashboard.html')
    data = parse(src)
    n = build(data, out)
    print(f'OK wrote {n} bytes -> {out}')
    print('apps:', [a for a in data['series'] if data['series'][a]])
