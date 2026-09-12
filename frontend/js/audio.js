"use strict";
/* 効果音・BGMの再生と音量設定の管理。localStorageに音量を保存する。
 *
 * <audio>.volume は使わない。iOS Safari（および他のiOSブラウザ全般。WebKit共通の
 * 制約）はJSからのvolume代入を無視し、常に端末のハード音量で再生してしまうため、
 * スライダーを動かしても実際の音量が変わらないという不具合になる。
 * 音量調整はWeb Audio APIのGainNodeで行う（AudioContextを経由した音声処理は
 * volume代入の制約を受けない）。
 */
(function () {
  const SFX_BASE = 'assets/sfx/';
  const BGM_BASE = 'assets/bgm/';
  const SFX_FILES = {
    correct: 'correct.m4a', incorrect: 'incorrect.m4a', tick: 'tick.m4a',
    tap: 'tap.m4a', start: 'start.m4a', victory: 'victory.m4a', timeup: 'timeup.m4a',
  };
  const BGM_FILES = { menu: 'menu.m4a' };
  const STORAGE_KEY = 'kbAudioSettings';
  const DEFAULTS = { se: 0.8, bgm: 0.4, muted: false };

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

  // AudioContextはユーザー操作（タップ等）の中でないとsuspendedのままになる
  // ブラウザが多いため、初回のplay/playBgm呼び出し時に遅延生成・resumeする。
  let ctx = null;
  let sfxGain = null;
  let bgmGain = null;
  function ensureContext() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null; // 極端に古い環境向けのフォールバックは持たない（対応環境で十分普及しているため）
    ctx = new Ctx();
    sfxGain = ctx.createGain();
    sfxGain.gain.value = settings.muted ? 0 : settings.se;
    sfxGain.connect(ctx.destination);
    bgmGain = ctx.createGain();
    bgmGain.gain.value = settings.muted ? 0 : settings.bgm;
    bgmGain.connect(ctx.destination);
    return ctx;
  }

  // <audio>要素をAudioContextのグラフにつなぐ。1要素につき1回だけ接続できる
  // （createMediaElementSourceは同じ要素に対して2回呼べない）ので、
  // 要素ごとに生成したノードをWeakMapで覚えておく。
  const sourceNodes = new WeakMap();
  function connectToGain(audioEl, gainNode) {
    if (!ctx) return;
    let src = sourceNodes.get(audioEl);
    if (!src) {
      src = ctx.createMediaElementSource(audioEl);
      sourceNodes.set(audioEl, src);
    }
    src.connect(gainNode);
  }

  let bgmAudio = null;
  let bgmKey = null;

  KBAudio.play = function (name) {
    if (settings.muted || settings.se <= 0 || !SFX_FILES[name]) return;
    const c = ensureContext();
    const a = new Audio(SFX_BASE + SFX_FILES[name]);
    if (c) connectToGain(a, sfxGain);
    a.play().catch(() => {});
  };

  KBAudio.playBgm = function (name) {
    if (bgmKey === name && bgmAudio && !bgmAudio.paused) return;
    KBAudio.stopBgm();
    if (!BGM_FILES[name]) return;
    const c = ensureContext();
    bgmKey = name;
    bgmAudio = new Audio(BGM_BASE + BGM_FILES[name]);
    bgmAudio.loop = true;
    if (c) connectToGain(bgmAudio, bgmGain);
    bgmAudio.play().catch(() => {});
  };

  KBAudio.stopBgm = function () {
    if (bgmAudio) { bgmAudio.pause(); bgmAudio.currentTime = 0; }
    bgmAudio = null; bgmKey = null;
  };

  // ページを開いた直後（まだ誰も画面を触っていない時点）はAudioContextが
  // suspendedのまま作られ、そこにつないだBGMは鳴らない。最初の操作で
  // AudioContextを起こし、鳴らし損ねたBGMを鳴らし直す。
  const WAKE_EVENTS = ['pointerdown', 'touchend', 'keydown'];
  function wakeAudio() {
    const c = ensureContext(); // suspendedならresumeを試みる
    if (bgmKey && bgmAudio && bgmAudio.paused) bgmAudio.play().catch(() => {});
    // resumeは非同期なので、runningになるまでは次の操作でもう一度試す
    if (c && c.state === 'running') {
      WAKE_EVENTS.forEach(t => window.removeEventListener(t, wakeAudio));
    }
  }
  WAKE_EVENTS.forEach(t => window.addEventListener(t, wakeAudio));

  KBAudio.getSettings = function () { return { ...settings }; };

  KBAudio.setSeVolume = function (v) {
    settings.se = Math.max(0, Math.min(1, v));
    if (sfxGain) sfxGain.gain.value = settings.muted ? 0 : settings.se;
    saveSettings();
  };
  KBAudio.setBgmVolume = function (v) {
    settings.bgm = Math.max(0, Math.min(1, v));
    if (bgmGain) bgmGain.gain.value = settings.muted ? 0 : settings.bgm;
    saveSettings();
  };
  KBAudio.setMuted = function (m) {
    settings.muted = !!m;
    if (sfxGain) sfxGain.gain.value = settings.muted ? 0 : settings.se;
    if (bgmGain) bgmGain.gain.value = settings.muted ? 0 : settings.bgm;
    saveSettings();
  };

  window.KBAudio = KBAudio;
})();
