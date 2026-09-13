"use strict";
/* 効果音・BGMの再生と音量設定の管理。localStorageに音量を保存する。
 *
 * iOSの制約として、JSからの <audio>.volume 代入は無視され、端末のハード音量で
 * 鳴る（Android・PCでは効く）。音量つまみをiOSでも効かせるにはWeb Audioの
 * GainNodeを通す必要がある。
 *
 * 効果音とBGMで鳴らし方が違う。iPhoneでの実機確認でこうなった。
 *
 * 効果音は <audio> をグラフにつながない。音のデータを読み込んで復号し、
 * 鳴らすたびに使い捨ての音源（BufferSource）をgainにつないで鳴らす。
 * iPhoneでは <audio> を createMediaElementSource でつなぐと、AudioContextが
 * running でも、その要素を一度鳴らせたあとでも無音になった（1回目は鳴り、
 * つないだ2回目から鳴らなくなる、という形で出た）。この接続は1要素につき
 * 1回きりで元に戻せないため、つないだ時点で手遅れになる。
 * BufferSourceなら鳴らすたびに作り直すので、無音のまま固定されることがない。
 *
 * BGMは長いので復号せず、これまでどおり <audio> をつなぐ。こちらは
 * 鳴らし始めたあとにつないでいるぶんには実機で鳴っている。
 *
 * 別のアプリに切り替えて戻ると、iPhoneではAudioContextの音の出口が切られて
 * resume() でも戻らない。戻ってきたらAudioContextごと捨てて作り直す
 *（つないだ <audio> はつなぎ直せないので、BGMは要素ごと作り直す）。
 *
 * 復号が間に合わない・Web Audioが使えない間は <audio> のまま鳴らす。
 * 音が出ないよりは、音量つまみが効かない方がましなので。
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
  // 一度でも鳴らせた要素。つないでよいのはこれだけ（冒頭の決まりごと2）
  const played = new WeakSet();

  function graphReady() { return !!ctx && ctx.state === 'running'; }

  function setupGraph() {
    if (ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      ctx = new Ctx();
      sfxGain = ctx.createGain(); sfxGain.connect(ctx.destination);
      bgmGain = ctx.createGain(); bgmGain.connect(ctx.destination);
    } catch (e) { ctx = null; return; }
    loadSfxBuffers(); // 復号は起きていなくてもできるので、待たずに始める
  }

  // 画面を触ったときに呼ぶ。ここでは起こすことだけをする（操作の中でしかできない
  // のはこれだけ）。作ることと復号は setupGraph / discardGraph 側で先に済ませる。
  function wakeGraph() {
    setupGraph();
    if (!ctx) return;
    if (ctx.state === 'running') { routeBgm(); return; }
    ctx.resume().then(routeBgm).catch(() => {});
  }

  // AudioContextを丸ごと捨てて作り直す。
  //
  // 作り直しはここで済ませ、次のタップには「起こす」だけを残す。AudioContextを
  // 作ることと音データを復号することは操作の外でもできるが、起こすことだけは
  // 操作の中でないとできないため。全部タップに寄せると、戻ってきて最初に押した
  // ときだけ画面がもたつく。
  //
  // 捨てている一瞬は graphReady() が false なので、効果音は <audio> のまま鳴る。
  // つまり作り直しが済む前でも音は止まらない。
  function discardGraph() {
    const old = ctx;
    ctx = null; sfxGain = null; bgmGain = null;
    // 古いAudioContextと一緒に消える音源なので、持っていても意味がない
    for (const name of Object.keys(sfxNodes)) sfxNodes[name] = null;
    if (old) { try { old.close(); } catch (e) {} }
    // 復号済みの音データはAudioContextに縛られないので、取り直さず使い回す
    setupGraph();

    // つないだ <audio> は新しいAudioContextにつなぎ直せない（1要素につき1回きり）。
    // BGMは要素ごと作り直す。次に画面を触ったときに鳴り始める。
    // 頭出しに戻らないよう、鳴っていた位置を引き継ぐ。
    if (bgmKey && bgmAudio && routed.has(bgmAudio)) {
      const key = bgmKey;
      const at = bgmAudio.currentTime || 0;
      KBAudio.stopBgm();
      KBAudio.playBgm(key);
      seekBgm(at);
    }
  }

  // 新しい要素はまだ長さが分かっていないことがあるので、分かってから位置を合わせる
  function seekBgm(at) {
    const el = bgmAudio;
    if (!el || !at) return;
    const seek = () => { try { el.currentTime = at; } catch (e) {} };
    if (el.readyState > 0) seek();
    else el.addEventListener('loadedmetadata', seek, { once: true });
  }

  // ── 効果音のデータ読み込み ────────────────────────────────────
  // 復号はAudioContextが起きてからでないとできない。失敗した音は <audio> の
  // ままになるだけで、鳴らなくなることはない。
  const sfxBuffers = {};
  let sfxLoadStarted = false;

  function loadSfxBuffers() {
    if (sfxLoadStarted || !ctx) return; // 起きていなくても復号はできる
    sfxLoadStarted = true;
    for (const name of Object.keys(SFX_FILES)) {
      fetch(audioUrl(SFX_BASE, SFX_FILES[name]))
        .then(res => res.arrayBuffer())
        // 古いSafariは Promise を返さないので、コールバック形式で受ける
        .then(buf => new Promise((ok, ng) => ctx.decodeAudioData(buf, ok, ng)))
        .then(decoded => { sfxBuffers[name] = decoded; })
        .catch(() => {});
    }
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
    // 鳴らせたことを確かめてからでないとつながない（冒頭の説明を参照）
    if (!bgmAudio || routed.has(bgmAudio) || !played.has(bgmAudio)) return;
    if (route(bgmAudio, bgmGain)) applyVolume(bgmAudio, 'bgm');
  }

  // BGMを鳴らし、鳴らせたらグラフにつなぐ。順番を逆にしない
  function playBgmAudio(el) {
    if (!el) return;
    el.play().then(() => {
      played.add(el);
      routeBgm();
    }).catch(() => {});
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

  // 復号が済むまでの控え。音ごとに1つだけ作って使い回す（鳴らすたびに
  // new Audio() すると、iOSは同時に扱える数に上限があるため、遊んでいるうちに
  // 新しい音が鳴らなくなる）。ここの要素はグラフにつながない。
  const sfxPool = {};
  // いま鳴っている音源。音の種類ごとに1つだけ持ち、鳴らし直すときに止める
  const sfxNodes = {};

  function stopSfx(name) {
    const prev = sfxNodes[name];
    if (!prev) return;
    sfxNodes[name] = null;
    try { prev.onended = null; prev.stop(); } catch (e) {}
  }

  KBAudio.play = function (name) {
    if (!SFX_FILES[name] || volumeOf('se') <= 0) return;

    // 復号が済んでいれば、使い捨ての音源で鳴らす。要素を残さないので、
    // どの端末でも「つないだせいで無音のまま固定される」ことがない。
    if (graphReady() && sfxBuffers[name]) {
      try {
        // 同じ音がまだ鳴っていたら止めてから鳴らし直す。作った音源はそのぶん
        // 重なって鳴るため、止めないと同じ音が二重に聞こえる（<audio>のときは
        // 頭出しして鳴らし直していたので、自然と1つだけになっていた）。
        stopSfx(name);
        const src = ctx.createBufferSource();
        src.buffer = sfxBuffers[name];
        src.connect(sfxGain);
        sfxGain.gain.value = volumeOf('se');
        src.onended = () => { if (sfxNodes[name] === src) sfxNodes[name] = null; };
        sfxNodes[name] = src;
        src.start();
        return;
      } catch (e) { /* 下の <audio> で鳴らす */ }
    }

    let a = sfxPool[name];
    if (!a) {
      a = new Audio(audioUrl(SFX_BASE, SFX_FILES[name]));
      sfxPool[name] = a;
    }
    applyVolume(a, 'se');
    try { a.currentTime = 0; } catch (e) {}
    a.play().catch(() => {});
  };

  KBAudio.playBgm = function (name) {
    // 同じ曲の用意が済んでいるなら、要素は作り直さず鳴らし直すだけにする。
    // 画面を移るたびにここへ来るので、作り直していると、止める前の音と
    // 重なって聞こえることがある。
    if (bgmKey === name && bgmAudio) {
      if (bgmAudio.paused) playBgmAudio(bgmAudio);
      return;
    }
    KBAudio.stopBgm();
    if (!BGM_FILES[name]) return;
    bgmKey = name;
    bgmAudio = new Audio(audioUrl(BGM_BASE, BGM_FILES[name]));
    bgmAudio.loop = true;
    bgmAudio.preload = 'auto';
    applyVolume(bgmAudio, 'bgm');
    // 画面を触る前は自動再生が止められる。その場合は下の操作待ち受けが鳴らし直す。
    playBgmAudio(bgmAudio);
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
        playBgmAudio(bgmAudio);
      }
    });
  });

  // 別のアプリに切り替えて戻るとAudioContextが止まったままになることがある。
  // つないだ要素はcontextが止まると鳴らなくなるので、戻ってきたら起こし直す。
  // 別のアプリに切り替えて戻ってくると、iPhoneではAudioContextの音の出口が
  // 切られていて、resume() しても音が戻らない（コードをコピーして友だちに送り、
  // 戻ってきたらBGMも効果音も鳴らなくなる、という形で出た）。
  // 直す方法が無いので、戻ってきたら古いものは捨てて作り直す。
  // 出口が生きているなら触らない（PCでタブを行き来しただけのときはこちら）。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !ctx) return;
    if (ctx.state !== 'running') discardGraph();
  });

  window.KBAudio = KBAudio;
})();
