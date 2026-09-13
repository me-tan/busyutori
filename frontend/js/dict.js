"use strict";
/* 漢字辞書。学年 → 部首 → 漢字 → くわしく、と降りていくだけの読み物で、
 * ゲームの状態（state）には触らない。
 *
 * kanji-dict.json は540KBあるので起動時には読まず、辞書を開いたときに読む。
 * 書き順のデータはさらに大きいので、部首ごとの小分け（shard）にして
 * 必要な分だけ取りに行く。
 *
 * 画面の切り替え（show）や部首のデータ（DATA）は index.html 側のものを使う。
 * このファイルは index.html のインラインスクリプトより先に読み込む。
 */

/* ── 漢字辞書 ───────────────────────────────────────────────────
   学年 → 部首 → 漢字 → くわしく、と降りていくだけの読み物。
   ゲームの状態（state）には触らない。
   kanji-dict.json は540KBあるので起動時には読まず、辞書を開いたときに読む。 */
let DICT = null;
let dictLoading = null;
// backTo は辞書のくわしい画面から戻る先。結果画面から開いたときは結果画面に返す
const dict = { level: 'elem', radical: null, kanji: null, backTo: 'dictKanjiScreen' };

// 何度呼んでも読み込みは1回だけ。失敗したら次の呼び出しでやり直せるようにする
function ensureDict() {
  if (DICT) return Promise.resolve(DICT);
  if (!dictLoading) {
    dictLoading = fetch('data/kanji-dict.json')
      .then(res => { if (!res.ok) throw new Error(res.status); return res.json(); })
      .then(json => { DICT = json.kanji; return DICT; })
      .catch(() => { dictLoading = null; return null; });
  }
  return dictLoading;
}

async function openDict() {
  const wait = document.getElementById('dictWait');
  const err = document.getElementById('dictErr');
  const btns = [...document.querySelectorAll('#dictLevelScreen .bigbtn[data-dictlevel]')];
  wait.classList.add('hidden');
  err.classList.add('hidden');
  show('dictLevelScreen');
  if (DICT) return;
  // 読み終わるまでは学年を選んでも中身が空なので、選べないようにしておく
  btns.forEach(b => { b.disabled = true; });
  wait.classList.remove('hidden');
  if (await ensureDict()) {
    btns.forEach(b => { b.disabled = false; });
  } else {
    err.textContent = '漢字辞書のデータが読み込めませんでした。通信環境を確かめてから、もう一度開いてください。';
    err.classList.remove('hidden');
  }
  wait.classList.add('hidden');
}

function dictGrades() { return GRADES[dict.level]; }

function renderDictRadicals() {
  // 部首マスターと違い、1字でもあれば出す（探せない部首があると辞書にならない）
  const list = Object.keys(DATA.radicals)
    .map(r => ({ r, n: poolOf(r, dictGrades()).length }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n);

  document.getElementById('dictRadGrid').innerHTML = list.map(x =>
    `<div class="radbtn" data-rad="${x.r}">` +
    `<div class="r">${radGlyph(x.r)}</div><div class="n">${DATA.radicals[x.r].name}</div>` +
    `<div class="c">${x.n}字</div></div>`
  ).join('');

  document.querySelectorAll('#dictRadGrid .radbtn').forEach(el => {
    el.onclick = () => { dict.radical = el.dataset.rad; renderDictKanjiList(); show('dictKanjiScreen'); };
  });
}

function renderDictKanjiList() {
  const rad = dict.radical;
  const d = DATA.radicals[rad];
  document.getElementById('dictKanjiTitle').textContent = `${radGlyph(rad)}（${d.name}）の漢字`;
  // なりたちは部首マスターの結果画面に出しているものと同じ（radicals.jsonのorigin）
  document.getElementById('dictRadHead').innerHTML =
    `<div class="r">${radGlyph(rad)}</div>` +
    `<div class="n">${d.name}</div>` +
    `<div class="m">${d.meaning}</div>` +
    (d.origin ? `<div class="dsec-h">なりたち</div><div class="o">${d.origin}</div>` : '');
  // 習う順に見られるよう学年の若い方から並べる
  const list = poolOf(rad, dictGrades());
  document.getElementById('dictKanjiGrid').innerHTML = list.map(k =>
    `<div class="kcell dcell" data-kanji="${k}">` +
    `<div class="k">${k}</div><div class="g">${GLABEL[DATA.kanji[k].grade] || ''}</div></div>`
  ).join('');

  document.querySelectorAll('#dictKanjiGrid .dcell').forEach(el => {
    el.onclick = () => {
      dict.kanji = el.dataset.kanji;
      dict.backTo = 'dictKanjiScreen';
      renderDictDetail();
      show('dictDetailScreen');
    };
  });
  loadStrokes(rad); // 字を選んだ時点で書き順が出せるよう、先に読んでおく
}

// 見出しのふりがなは、自動のふりがな（js/furigana.js）に任せず直接書く。
// 「使い方」の「方」は「かた」だが、説明文の「日がのぼる方」は「ほう」で、
// 辞書引きでは読み分けられないため。見出しは決まった文言なので直接書ける。
function ruby(kanji, yomi) { return `<ruby>${kanji}<rt>${yomi}</rt></ruby>`; }
const SEC_MEAN  = ruby('意味', 'いみ');
const SEC_ON    = ruby('音読', 'おんよ') + 'み';
const SEC_KUN   = ruby('訓読', 'くんよ') + 'み';
const SEC_WORDS = ruby('使', 'つか') + 'い' + ruby('方', 'かた');

// KANJIDIC2の訓読みは「つか.える」「はつ-」「-そ.める」の形。
// . より後ろが送り仮名、- は接頭語・接尾語の印なので、読み物としては落とす。
function kunLabel(s) {
  const body = s.replace(/-/g, '');
  const i = body.indexOf('.');
  return i < 0 ? body : body.slice(0, i) + '（' + body.slice(i + 1) + '）';
}

function renderDictDetail() {
  const k = dict.kanji;
  const e = DICT ? DICT[k] : null;
  const grade = DATA.kanji[k] ? DATA.kanji[k].grade : '';
  stopStrokes();
  const parts = [
    `<div class="dhead">`,
    // 書き順が読み込めたらSVGに差し替わる。読めなければこの字のまま
    `<div class="dkanjibox" id="dictStrokeBox"><div class="dkanji">${k}</div></div>`,
    `<div class="dplay hidden" id="dictPlayRow">`,
    `<button class="ghost" id="dictPlay">書き順をもう一度</button>`,
    `<span class="cnt" id="dictStrokeCnt"></span>`,
    `</div>`,
    // 書き順のデータが印刷用の字体しか持っておらず、習う画数と合わない字がある
    e && e.vstrokes ? `<div class="dnote">書き順は印刷でよく使う形（${e.vstrokes}画）で出しています。` +
                      `学校で習う形は${e.strokes}画です。</div>` : '',
    `<div class="dfacts">`,
    `<span>部首<b class="dv">${radGlyph(dict.radical)}</b></span>`,
    e ? `<span>画数<b class="dv">${e.strokes}</b></span>` : '',
    `<span>習う学年<b class="dv">${GLABEL[grade] || '-'}</b></span>`,
    `</div></div>`,
  ];
  if (!e) {
    // DICTがまだ無いのは読み込み中、あるのに引けないのは本当に無いとき
    parts.push(`<div class="dsec"><div class="dmean">` +
      (DICT ? 'この漢字の情報が読み込めませんでした。' : '読み込んでいます…') +
      `</div></div>`);
  } else {
    if (e.mean) {
      parts.push(`<div class="dsec"><div class="dsec-h">${SEC_MEAN}</div><div class="dmean">${e.mean}</div></div>`);
    }
    parts.push(readingSection(SEC_ON, e.on));
    // 「はつ」と「はつ-」のように、印を落とすと同じになる読みがあるのでまとめる
    parts.push(readingSection(SEC_KUN, [...new Set(e.kun.map(kunLabel))]));
    if (e.words.length) {
      parts.push(`<div class="dsec"><div class="dsec-h">${SEC_WORDS}</div><div class="dwords">` +
        e.words.map(([w, y]) => `<div class="dword"><div class="w">${w}</div><div class="y">${y}</div></div>`).join('') +
        `</div></div>`);
    }
  }
  document.getElementById('dictDetail').innerHTML = parts.join('');
  paintStrokes(dict.radical, k);
}

/* ── 書き順 ─────────────────────────────────────────────────────
   KanjiVGのSVGは1画が1つの<path>で、並び順がそのまま書き順。
   線の長さぶんの破線を引いてから、その隙間を詰めていくと1画を書く動きになる。
   データは部首ごとに分けてあるので、その部首ぶんだけを読む。 */
const strokeShards = {};

function shardName(rad) {
  return ('0000' + rad.codePointAt(0).toString(16)).slice(-5);
}

function loadStrokes(rad) {
  const name = shardName(rad);
  if (!strokeShards[name]) {
    strokeShards[name] = fetch(`data/strokes/${name}.json`)
      .then(res => { if (!res.ok) throw new Error(res.status); return res.json(); })
      .catch(() => { delete strokeShards[name]; return null; }); // 次に開いたときに読み直せるようにする
  }
  return strokeShards[name];
}

async function paintStrokes(rad, k) {
  const data = await loadStrokes(rad);
  if (dict.kanji !== k) return; // 読んでいる間に別の字へ移っていたら捨てる
  const paths = data && data[k];
  if (!paths || !paths.length) return; // 読めなければ字を出したままにする
  const g = ps => ps.map(d => `<path d="${d}"/>`).join('');
  document.getElementById('dictStrokeBox').innerHTML =
    `<svg class="dsvg" viewBox="0 0 109 109" id="dictSvg">` +
    `<g class="guide"><line x1="54.5" y1="2" x2="54.5" y2="107"/>` +
    `<line x1="2" y1="54.5" x2="107" y2="54.5"/></g>` +
    `<g class="model">${g(paths)}</g><g class="live">${g(paths)}</g></svg>`;
  document.getElementById('dictPlayRow').classList.remove('hidden');
  document.getElementById('dictPlay').onclick = playStrokes;
  playStrokes();
}

let strokeTimer = null;

function stopStrokes() {
  clearTimeout(strokeTimer);
  strokeTimer = null;
}

function playStrokes() {
  stopStrokes();
  const svg = document.getElementById('dictSvg');
  if (!svg) return;
  const cnt = document.getElementById('dictStrokeCnt');
  const paths = [...svg.querySelectorAll('.live path')];
  // 動きを減らす設定の端末では、線を引く動きはやめて1画ずつ出すだけにする
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  for (const p of paths) {
    const len = p.getTotalLength();
    p.style.transition = 'none';
    p.style.strokeDasharray = len;
    p.style.strokeDashoffset = len;
    p.classList.remove('now');
  }
  svg.getBoundingClientRect(); // 消した状態を一度確定させてから引き始める

  let i = 0;
  const step = () => {
    if (i > 0) paths[i - 1].classList.remove('now');
    if (i >= paths.length) {
      // 引き終わったら破線の指定を外し、ふつうの字として残す
      for (const p of paths) { p.style.transition = ''; p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; }
      cnt.textContent = `ぜんぶで${paths.length}画`;
      strokeTimer = null;
      return;
    }
    const p = paths[i];
    const len = p.getTotalLength();
    const dur = still ? 0 : Math.max(220, Math.min(900, len * 11));
    p.style.transition = still ? 'none' : `stroke-dashoffset ${dur}ms linear`;
    p.style.strokeDashoffset = 0;
    p.classList.add('now');
    cnt.textContent = `${i + 1}画目`;
    i++;
    strokeTimer = setTimeout(step, dur + 160);
  };
  step();
}

function readingSection(title, list) {
  const body = list.length
    ? `<div class="dread">${list.map(r => `<span>${r}</span>`).join('')}</div>`
    : `<div class="dread none">ありません</div>`;
  return `<div class="dsec"><div class="dsec-h">${title}</div>${body}</div>`;
}
