"use strict";
/* 効果音・BGMの再生と音量設定の管理。localStorageに音量を保存する。 */
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
  let bgmAudio = null;
  let bgmKey = null;

  const KBAudio = {};

  KBAudio.play = function (name) {
    if (settings.muted || settings.se <= 0 || !SFX_FILES[name]) return;
    const a = new Audio(SFX_BASE + SFX_FILES[name]);
    a.volume = settings.se;
    a.play().catch(() => {});
  };

  KBAudio.playBgm = function (name) {
    if (bgmKey === name && bgmAudio && !bgmAudio.paused) return;
    KBAudio.stopBgm();
    if (!BGM_FILES[name]) return;
    bgmKey = name;
    bgmAudio = new Audio(BGM_BASE + BGM_FILES[name]);
    bgmAudio.loop = true;
    bgmAudio.volume = settings.muted ? 0 : settings.bgm;
    bgmAudio.play().catch(() => {});
  };

  KBAudio.stopBgm = function () {
    if (bgmAudio) { bgmAudio.pause(); bgmAudio.currentTime = 0; }
    bgmAudio = null; bgmKey = null;
  };

  KBAudio.getSettings = function () { return { ...settings }; };

  KBAudio.setSeVolume = function (v) {
    settings.se = Math.max(0, Math.min(1, v));
    saveSettings();
  };
  KBAudio.setBgmVolume = function (v) {
    settings.bgm = Math.max(0, Math.min(1, v));
    if (bgmAudio) bgmAudio.volume = settings.muted ? 0 : settings.bgm;
    saveSettings();
  };
  KBAudio.setMuted = function (m) {
    settings.muted = !!m;
    if (bgmAudio) bgmAudio.volume = settings.muted ? 0 : settings.bgm;
    saveSettings();
  };

  window.KBAudio = KBAudio;
})();
