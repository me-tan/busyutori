// 手書き漢字の認識。DaKanji の単漢字CNN（MIT）を ONNX Runtime Web で動かす。
// KanjiCanvas が記録したストロークを画像に描き直してモデルに渡す。
// 画像を見るモデルなので、筆順・画数が多少違っても認識できる。
(function (window) {
"use strict";

const MODEL_URL = '/models/kanji-recog.onnx';
const LABELS_URL = '/models/kanji-recog-labels.txt';
const WASM_DIR = '/js/vendor/ort/';

const INPUT_SIZE = 64;    // モデルの入力サイズ
const RENDER_SIZE = 256;  // 一度大きく描いてから縮小し、線のなめらかさを稼ぐ
const INK_FILL = 0.7;     // 枠に対して文字が占める割合。学習データの字取りに合わせてある
const STROKE_PX = 8;      // RENDER_SIZE換算での線の太さ

// モデルは2010年の字体改定前のデータで学習されているので、ゲーム側の字体に読み替える
const VARIANTS = { '剥': '剝', '填': '塡', '頬': '頰', '叱': '𠮟' };

let session = null;
let labels = null;
let loadPromise = null;

function load() {
  if (loadPromise) return loadPromise;
  ort.env.wasm.wasmPaths = WASM_DIR;
  ort.env.wasm.numThreads = 1;
  loadPromise = Promise.all([
    ort.InferenceSession.create(MODEL_URL),
    fetch(LABELS_URL).then((r) => r.text()),
  ]).then(([s, text]) => {
    session = s;
    labels = text; // 区切り文字なし。1文字目がクラス0、2文字目がクラス1……
  });
  return loadPromise;
}

function strokesOf(id) {
  return window.KanjiCanvas['recordedPattern_' + id] || [];
}

function inkBounds(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    for (const p of s) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
  }
  return { x0, y0, x1, y1 };
}

// モデルは「枠いっぱいに中央寄せされた字」しか想定していない。
// 小さく書いたり隅に寄ったりすると当たらないので、書いた範囲で切り出して中央に置き直す。
function renderInk(strokes) {
  const c = document.createElement('canvas');
  c.width = c.height = RENDER_SIZE;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, RENDER_SIZE, RENDER_SIZE);

  const b = inkBounds(strokes);
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0, 1);
  const scale = (RENDER_SIZE * INK_FILL) / span;

  g.translate(RENDER_SIZE / 2, RENDER_SIZE / 2);
  g.scale(scale, scale);
  g.translate(-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2);

  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = STROKE_PX / scale;
  for (const s of strokes) {
    if (!s.length) continue;
    g.beginPath();
    g.moveTo(s[0][0], s[0][1]);
    for (let i = 1; i < s.length; i++) g.lineTo(s[i][0], s[i][1]);
    if (s.length === 1) g.lineTo(s[0][0] + 0.01, s[0][1]); // 点だけの画
    g.stroke();
  }
  return c;
}

function toTensor(source) {
  const c = document.createElement('canvas');
  c.width = c.height = INPUT_SIZE;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const px = g.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
  const data = new Float32Array(INPUT_SIZE * INPUT_SIZE);
  for (let i = 0; i < data.length; i++) data[i] = px[i * 4]; // 白黒なのでR成分だけでよい
  return new ort.Tensor('float32', data, [1, 1, INPUT_SIZE, INPUT_SIZE]);
}

// strokes を認識する。
// allowed（Setまたはnull）を渡すと、その中だけで順位を付けた pool も返す。
// 返り値: { top: [[漢字, 確率], ...], pool: [[漢字, 確率], ...] }（どちらも確率の降順）
async function recognize(strokes, allowed, topN) {
  await load();
  const n = topN || 5;
  if (!strokes || !strokes.length) return { top: [], pool: [] };

  const out = await session.run({ image: toTensor(renderInk(strokes)) });
  const probs = out.probs.data;

  const top = [];
  const pool = [];
  for (let i = 0; i < probs.length; i++) {
    const ch = VARIANTS[labels[i]] || labels[i];
    const entry = [ch, probs[i]];
    top.push(entry);
    if (allowed && allowed.has(ch)) pool.push(entry);
  }
  const byProb = (a, b) => b[1] - a[1];
  top.sort(byProb);
  pool.sort(byProb);
  return { top: top.slice(0, n), pool: pool.slice(0, n) };
}

window.KanjiRecog = { load, strokesOf, recognize, renderInk };

})(window);
