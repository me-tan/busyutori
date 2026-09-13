"use strict";
/* 効果音・BGMの再生と音量設定の管理。localStorageに音量を保存する。
 *
 * iOSの制約として、JSからの <audio>.volume 代入は無視され、端末のハード音量で
 * 鳴る（Android・PCでは効く）。音量つまみをiOSでも効かせるにはWeb Audioの
 * GainNodeを通す必要がある。
 *
 * つなぐときの決まりごと：AudioContextが running になったことを確かめてから
 * でないとつながない。suspended のままつなぐと、その要素の音はどこにも出なく
 * なる。resume() は非同期なので呼んだ直後はまだ running ではなく、しかも
 * createMediaElementSource は1要素につき1回きりで元に戻せないため、一度そう
 * なった要素は二度と鳴らない。
 *
 * つないでいない間は <audio> のまま鳴らす。Web Audioが使えない・起こせない
 * 環境でも音が消えないようにするため。
 *
 * 消音スイッチ（マナーモード）中は鳴らさない方針。iOS 16.4以降の
 * navigator.audioSession に ambient を指定して、消音スイッチを尊重し、かつ
 * 相手が自分で流している音楽を止めないようにする。
 */
(function () {
  const SFX_BASE = 'assets/sfx/';
  const BGM_BASE = 'assets/bgm/';
  const SFX_FILES = {
    correct: 'correct.m4a', incorrect: 'incorrect.m4a', tick: 'tick.m4a',
    tap: 'tap.m4a', start: 'start.m4a', victory: 'victory.m4a', timeup: 'timeup.m4a',
  };
  const BGM_FILES = { menu: 'menu.m4a' };

  // 音のファイルは読み込みが重いのでキャッシュを許可している。そのため作り直しても
  // 古いものが鳴り続けてしまうので、URLに版番号を付けて別物として取りに行かせる。
  // 音源を作り直したら、この数字を1つ増やすこと。
  const AUDIO_VERSION = 2;
  function audioUrl(base, file) { return `${base}${file}?v=${AUDIO_VERSION}`; }
  const STORAGE_KEY = 'kbAudioSettings';
  // 音源ファイル自体を小さい音で作り直してある（BGM -12dB、効果音 -6dB）ので、
  // ここは下げすぎない。iOSはこの値を無視するため、iOSでの大きさは音源側で決まる。
  const DEFAULTS = { se: 0.8, bgm: 0.8, muted: false };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULTS };
      const s = JSON.parse(raw);
      return {
        se: typeof s.se === 'number' ? s.se : DEFAULTS.se,
        bgm: typeof s.bgm === 'number' ? s.bgm : DEFAULTS.bgm,
        muted: !!s.muted,
      };
    } catch (e) { return { ...DEFAULTS }; }
  }
  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) {}
  }

  const settings = loadSettings();
  const KBAudio = {};

  // ── Web Audio 経由の音量調整 ──────────────────────────────────
  // つないだ要素はgainで音量を決める。つないでいない要素は <audio>.volume を使う。
  let ctx = null, sfxGain = null, bgmGain = null;
  const routed = new WeakSet();

  function graphReady() { return !!ctx && ctx.state === 'running'; }

  function setupGraph() {
    if (ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      ctx = new Ctx();
      sfxGain = ctx.createGain(); sfxGain.connect(ctx.destination);
      bgmGain = ctx.createGain(); bgmGain.connect(ctx.destination);
    } catch (e) { ctx = null; }
  }

  // 画面を触ったときに呼ぶ。runningになって初めて、鳴っているBGMをつなぎ替える。
  function wakeGraph() {
    setupGraph();
    if (!ctx) return;
    if (ctx.state === 'running') { routeBgm(); return; }
    ctx.resume().then(routeBgm).catch(() => {});
  }

  // 要素をグラフにつなぐ。runningでなければ何もしない（つなぐと音が出なくなるため）
  function route(el, gain) {
    if (!graphReady() || !gain || !el || routed.has(el)) return false;
    try {
      ctx.createMediaElementSource(el).connect(gain);
      routed.add(el);
      return true;
    } catch (e) { return false; }
  }

  function routeBgm() {
    if (!bgmAudio || routed.has(bgmAudio)) return;
    if (route(bgmAudio, bgmGain)) applyVolume(bgmAudio, 'bgm');
  }

  // 消音スイッチ（マナーモード）中は鳴らさない。あわせて、相手が自分で流している
  // 音楽を止めてしまわないようにする。ambientがこの両方を満たす区分。
  // 対応していない環境でも、もともと消音スイッチは尊重されるので何もしない。
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'ambient';
  } catch (e) {}

  function volumeOf(kind) {
    if (settings.muted) return 0;
    return kind === 'bgm' ? settings.bgm : settings.se;
  }

  function applyVolume(el, kind) {
    if (!el) return;
    const v = volumeOf(kind);
    if (routed.has(el)) {
      // グラフ側で絞るので、要素そのものは最大のままにしておく
      const g = kind === 'bgm' ? bgmGain : sfxGain;
      if (g) g.gain.value = v;
      el.volume = 1;
      el.muted = false;
      return;
    }
    el.volume = v;     // iOSでは無視されるが、Android・PCでは効く
    el.muted = v <= 0; // iOSでも効くので、消音だけは確実にできる
  }

  let bgmAudio = null;
  let bgmKey = null;

  // 効果音は音ごとに1つだけ作って使い回す。鳴らすたびに new Audio() すると、
  // グラフにつないだぶんだけ音声の読み込み口が増え続け、iOSは同時に扱える数に
  // 上限があるため、遊んでいるうちに新しい音が鳴らなくなる（BGMも鳴らなくなる）。
  // 使い回すと接続は音の種類ぶん（7個）で頭打ちになる。
  // 同じ音が重なったときは鳴らし直しになるが、この遊び方では困らない。
  const sfxPool = {};

  KBAudio.play = function (name) {
    if (!SFX_FILES[name] || volumeOf('se') <= 0) return;
    let a = sfxPool[name];
    if (!a) {
      a = new Audio(audioUrl(SFX_BASE, SFX_FILES[name]));
      sfxPool[name] = a;
    }
    route(a, sfxGain);
    applyVolume(a, 'se');
    try { a.currentTime = 0; } catch (e) {}
    a.play().catch(() => {});
  };

  KBAudio.playBgm = function (name) {
    if (bgmKey === name && bgmAudio && !bgmAudio.paused) return;
    KBAudio.stopBgm();
    if (!BGM_FILES[name]) return;
    bgmKey = name;
    bgmAudio = new Audio(audioUrl(BGM_BASE, BGM_FILES[name]));
    bgmAudio.loop = true;
    bgmAudio.preload = 'auto';
    route(bgmAudio, bgmGain);
    applyVolume(bgmAudio, 'bgm');
    // 画面を触る前は自動再生が止められる。その場合は下のwakeAudioが鳴らし直す。
    bgmAudio.play().catch(() => {});
  };

  KBAudio.stopBgm = function () {
    if (bgmAudio) { bgmAudio.pause(); bgmAudio.currentTime = 0; }
    bgmAudio = null; bgmKey = null;
  };

  KBAudio.getSettings = function () { return { ...settings }; };

  // この端末でアプリから音量を変えられるか。
  //
  // 「volumeに代入して読み返す」やり方では判定できない。iOSは代入された値を
  // プロパティとしては保持して読み返せるのに、再生時にはそれを無視して端末の
  // 音量で鳴らすため、どの端末でも「変えられる」と判定されてしまう（実機で確認）。
  // そのため、この制約を持つiOS（iPhone・iPad。iOSではブラウザの種類を問わず
  // 同じ制約になる）かどうかで判断する。
  KBAudio.canControlVolume = function () {
    if (graphReady()) return true; // GainNodeを通せるので、iOSでも音量を変えられる
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua)) return false;
    // iPadOS 13以降のSafariはMacを名乗るので、タッチできるMacはiPadとみなす
    if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return false;
    return true;
  };

  KBAudio.setSeVolume = function (v) {
    settings.se = Math.max(0, Math.min(1, v)); // 効果音は鳴らすたびに作るので次の音から反映される
    if (sfxGain) sfxGain.gain.value = volumeOf('se');
    saveSettings();
  };
  KBAudio.setBgmVolume = function (v) {
    settings.bgm = Math.max(0, Math.min(1, v));
    applyVolume(bgmAudio, 'bgm');
    saveSettings();
  };
  KBAudio.setMuted = function (m) {
    settings.muted = !!m;
    applyVolume(bgmAudio, 'bgm');
    if (sfxGain) sfxGain.gain.value = volumeOf('se');
    saveSettings();
  };

  // ページを開いた直後はまだ誰も画面を触っていないので、ブラウザが自動再生を
  // 止めてBGMが鳴らない。スマホは特に厳しいので、操作のたびに「鳴るはずなのに
  // 止まっているBGM」を鳴らし直す。
  ['pointerdown', 'touchend', 'keydown'].forEach(type => {
    window.addEventListener(type, () => {
      wakeGraph(); // 操作の中でないとAudioContextは起きない
      if (bgmKey && bgmAudio && bgmAudio.paused) {
        applyVolume(bgmAudio, 'bgm');
        bgmAudio.play().catch(() => {});
      }
    });
  });

  // 別のアプリに切り替えて戻るとAudioContextが止まったままになることがある。
  // つないだ要素はcontextが止まると鳴らなくなるので、戻ってきたら起こし直す。
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  });

  window.KBAudio = KBAudio;
})();
