"use strict";
/* オンライン対戦。部屋の作成・参加からゲームの進行までをまとめている。
 *
 * 進行はサーバー（backend/）が持ち、この層はサーバーから届く出来事
 * （start / offer / defend / turn_result / game_over）を画面に映すだけにする。
 * 勝敗や使用済みの判定をこちら側で持たないのは、2人の画面で食い違わないようにするため。
 *
 * ひとり用と共通の部品（show・DATA・poolOf・判定まわり・KanjiCanvas など）は
 * index.html 側で定義しているものをそのまま使う。このファイルは index.html の
 * インラインスクリプトより先に読み込む（boot() から bBind() を呼ぶため）。
 */
const bstate = {
  code: null, myId: null, level: null,
  radical: null, deadline: 0, totalSeconds: 0, tickId: null, quickTimeoutId: null,
  isDefending: false, used: [], locked: false, setupStep: 'battleChoice',
};
const QUICKMATCH_TIMEOUT_SECONDS = 20;

const BATTLE_STEPS = ['battleChoice', 'battleFriendPanel', 'battleQuickPanel', 'battleCreatePanel', 'battleJoinPanel', 'battleWaiting', 'quickWaiting'];
const BATTLE_PARENT_STEP = {
  battleFriendPanel: 'battleChoice', battleQuickPanel: 'battleChoice',
  battleCreatePanel: 'battleFriendPanel', battleJoinPanel: 'battleFriendPanel',
};

const BATTLE_STEP_TITLE = {
  battleChoice: 'だれかと対戦する', battleFriendPanel: '部屋コードで対戦',
  battleQuickPanel: '難易度をえらぶ', battleCreatePanel: '難易度をえらぶ',
  battleJoinPanel: '部屋に入る', battleWaiting: '部屋コードで対戦', quickWaiting: 'すぐに対戦',
};

function battleShowStep(step) {
  BATTLE_STEPS.forEach(id => document.getElementById(id).classList.toggle('hidden', id !== step));
  bstate.setupStep = step;
  document.getElementById('battleSetupTitle').textContent = BATTLE_STEP_TITLE[step];
}

function battleBackStep() {
  if (bstate.setupStep === 'quickWaiting' && bstate.code && bstate.myId) {
    Net.cancelRoom(bstate.code, bstate.myId);
  }
  if (bstate.setupStep === 'battleWaiting' || bstate.setupStep === 'quickWaiting') { bReset(); return; }
  const parent = BATTLE_PARENT_STEP[bstate.setupStep];
  if (parent) { battleShowStep(parent); bSetErr(''); }
  else { bReset(); show('modeScreen'); }
}

function bReset() {
  Net.close();
  bstate.code = null; bstate.myId = null; bstate.level = null;
  bstate.radical = null; bstate.deadline = 0; bstate.used = []; bstate.locked = false;
  clearInterval(bstate.tickId);
  clearTimeout(bstate.quickTimeoutId);
  battleShowStep('battleChoice');
  bSetErr('');
  bSetBusy('');
}

function bSetErr(t) {
  const el = document.getElementById('battleErr');
  if (!t) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.classList.remove('hidden'); el.textContent = t;
}

let battleBusyTimer = null;
function bSetBusy(t) {
  clearTimeout(battleBusyTimer);
  const el = document.getElementById('battleBusy');
  document.querySelectorAll('#battleSetupScreen button').forEach(b => { b.disabled = !!t; });
  if (!t) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.classList.remove('hidden'); el.textContent = t;
}

async function bCreateRoom(level) {
  bSetErr('');
  bSetBusy('部屋を作っています…');
  battleBusyTimer = setTimeout(
    () => bSetBusy('部屋を作っています…（サーバーが起動中の場合があります。もう少しお待ちください）'), 6000);
  try {
    const room = await Net.createRoom(level);
    bstate.code = room.code; bstate.myId = room.player_id; bstate.level = level;
    bSetBusy('');
    bEnterWaiting('相手を待っています…');
    bConnect();
  } catch (e) {
    bSetBusy('');
    bSetErr('部屋を作れませんでした。通信環境を確認してください。');
  }
}

async function bJoinRoom(code) {
  bSetErr('');
  bSetBusy('部屋に入っています…');
  battleBusyTimer = setTimeout(
    () => bSetBusy('部屋に入っています…（サーバーが起動中の場合があります。もう少しお待ちください）'), 6000);
  try {
    const room = await Net.joinRoom(code);
    bstate.code = room.code; bstate.myId = room.player_id; bstate.level = room.level;
    bSetBusy('');
    bEnterWaiting('対戦を開始しています…');
    bConnect();
  } catch (e) {
    bSetBusy('');
    bSetErr('その部屋には入れませんでした。コードを確認してください。');
  }
}

async function bQuickMatch(level) {
  bSetErr('');
  bSetBusy('対戦相手をさがしています…');
  battleBusyTimer = setTimeout(
    () => bSetBusy('対戦相手をさがしています…（サーバーが起動中の場合があります）'), 6000);
  try {
    const room = await Net.quickMatch(level);
    bstate.code = room.code; bstate.myId = room.player_id; bstate.level = level;
    bSetBusy('');
    bEnterQuickWaiting();
    bConnect();
    if (room.is_host) {
      bstate.quickTimeoutId = setTimeout(() => {
        Net.cancelRoom(bstate.code, bstate.myId);
        bReset();
        bSetErr('対戦相手が見つかりませんでした。もう一度お試しください。');
      }, QUICKMATCH_TIMEOUT_SECONDS * 1000);
    }
  } catch (e) {
    bSetBusy('');
    bSetErr('マッチングできませんでした。通信環境を確認してください。');
  }
}

function bEnterQuickWaiting() {
  battleShowStep('quickWaiting');
}

function bEnterWaiting(msg) {
  battleShowStep('battleWaiting');
  document.getElementById('roomCodeDisplay').textContent = bstate.code;
  document.getElementById('waitingMsg').textContent = msg;
}

function bConnect() {
  Net.connect(bstate.code, bstate.myId);
  Net.on('start', onBStart);
  Net.on('offer', onBOffer);
  Net.on('defend', onBDefend);
  Net.on('answer_rejected', onBRejected);
  Net.on('turn_result', onBTurnResult);
  Net.on('game_over', onBGameOver);
  Net.on('rematch_requested', onBRematchRequested);
  Net.on('rematch_declined', onBRematchDeclined);
  Net.on('closed', () => bSetErr('通信が切れました。もう一度お試しください。'));
}

function onBStart() {
  pendingInvite = null;
  clearTimeout(bstate.quickTimeoutId);
  document.getElementById('bRoomCodeBox').classList.add('hidden');
  document.getElementById('bRoomCode').textContent = bstate.code;
  document.getElementById('bGiveUp').classList.add('hidden');
  bRenderUsed();
  show('battlePlayScreen');
  KBAudio.play('start');
}

function onBOffer(msg) {
  clearInterval(bstate.tickId);
  bstate.locked = false;
  bstate.used = msg.used || [];
  bstate.radical = null; // 次の部首が投げられるまでは「出題中の部首」なし
  bRenderUsed();
  KanjiCanvas.erase('canBattle');
  document.getElementById('bPicker').classList.add('hidden');
  bSetMsg('', '');
  document.getElementById('bStatus').classList.remove('myturn');

  const iAmAttacker = msg.attacker === bstate.myId;
  document.getElementById('bOfferBox').classList.toggle('hidden', !iAmAttacker);
  document.getElementById('bBoard').classList.add('hidden');
  document.getElementById('bRadicalBox').classList.add('hidden');
  document.getElementById('bTimer').textContent = '-';

  if (iAmAttacker) {
    const statusEl = document.getElementById('bStatus');
    statusEl.textContent = 'あなたの番です。部首をえらんで、相手に投げてください';
    statusEl.classList.add('myturn');
    KBAudio.play('tap');
    document.getElementById('bOfferRow').innerHTML = msg.choices.map(c =>
      `<div class="radbtn" data-radical="${c.radical}">` +
      `<div class="r">${radGlyph(c.radical)}</div><div class="n">${c.name}</div></div>`
    ).join('');
    document.querySelectorAll('#bOfferRow .radbtn').forEach(el => {
      el.onclick = () => {
        document.getElementById('bOfferBox').classList.add('hidden');
        statusEl.classList.remove('myturn');
        statusEl.textContent = '相手が書くのを待っています…';
        Net.send('throw', { radical: el.dataset.radical });
      };
    });
  } else {
    document.getElementById('bStatus').textContent = '相手が部首をえらんでいます…';
  }
}

function onBDefend(msg) {
  document.getElementById('bStatus').classList.remove('myturn');
  bstate.radical = msg.radical;
  bstate.isDefending = msg.defender === bstate.myId;
  bstate.deadline = Date.now() + msg.seconds * 1000;
  bstate.totalSeconds = msg.seconds;
  bRenderUsedFocus(); // 出題された部首で既に使われた字を出し直す

  const d = DATA.radicals[msg.radical];
  document.getElementById('bRadicalBox').classList.remove('hidden');
  document.getElementById('bRadical').textContent = radGlyph(msg.radical);
  document.getElementById('bRadName').textContent = d.name;
  document.getElementById('bRadMeaning').textContent = d.meaning;
  document.getElementById('bOfferBox').classList.add('hidden');

  if (bstate.isDefending) {
    document.getElementById('bStatus').textContent = 'この部首を含む漢字を書いてください';
    document.getElementById('bBoard').classList.remove('hidden');
    document.getElementById('bGiveUp').classList.remove('hidden');
    KanjiCanvas.erase('canBattle');
    fitCanvas('canBattle');
  } else {
    document.getElementById('bStatus').textContent = '相手が書いています…';
    document.getElementById('bGiveUp').classList.add('hidden');
  }
  bTick();
}

function bTick() {
  clearInterval(bstate.tickId);
  const ring = document.getElementById('bTimerRingFg');
  const render = () => {
    const left = Math.max(0, Math.ceil((bstate.deadline - Date.now()) / 1000));
    const el = document.getElementById('bTimer');
    el.textContent = left;
    const low = left <= 5;
    el.classList.toggle('low', low);
    updateRing(ring, left / bstate.totalSeconds, low);
    if (left <= 0) clearInterval(bstate.tickId);
  };
  render();
  bstate.tickId = setInterval(render, 250);
}

async function bJudge() {
  if (bstate.locked || !bstate.isDefending) return;
  const inRange = new Set(poolOf(bstate.radical, ALL_GRADES));
  const usedSet = new Set(usedEntries().map(u => u.kanji));

  const strokes = KanjiRecog.strokesOf('canBattle');
  const { top, pool } = await KanjiRecog.recognize(strokes, answerableSet(inRange, usedSet));
  if (bstate.locked || !bstate.isDefending) return; // 認識を待つ間に手番が終わっていることがある

  const valid = validCandidates(top, pool, strokes.length);

  const picker = document.getElementById('bPicker');
  const row = document.getElementById('bPickRow');
  row.innerHTML = '';

  if (!valid.length) {
    picker.classList.add('hidden');
    bSetMsg(explainMiss(top, inRange, inRange, usedSet), 'ng');
    return;
  }

  bSetMsg('', '');
  // 1位がはっきり抜けているならタップさせずに送信する
  if (valid.length === 1 || valid[1][1] < valid[0][1] * OCR_AMBIGUOUS) { bSubmit(valid[0][0]); return; }
  picker.classList.remove('hidden');
  for (const [k] of valid) {
    const b = document.createElement('button');
    b.className = 'pick';
    const g = DATA.kanji[k] ? DATA.kanji[k].grade : '';
    b.innerHTML = k + '<small>' + (GLABEL[g] || '') + '</small>';
    b.onclick = () => bSubmit(k);
    row.appendChild(b);
  }
}

function bSubmit(kanji) {
  if (bstate.locked) return;
  bstate.locked = true;
  document.getElementById('bPicker').classList.add('hidden');
  bSetMsg(kanji + '  送信しました', 'ok');
  Net.send('answer', { kanji });
}

function onBRejected(msg) {
  bstate.locked = false;
  const why = { used: 'もう使われています', not_in_radical: 'その部首を含みません' };
  bSetMsg(`「${msg.kanji}」は${why[msg.reason] || '認められませんでした'}`, 'ng');
}

function onBTurnResult(msg) {
  clearInterval(bstate.tickId);
  bstate.used = msg.used || [];
  bRenderUsed();
  KBAudio.play('correct');
}

function onBGameOver(msg) {
  clearInterval(bstate.tickId);
  const iLost = msg.loser === bstate.myId;
  const title = document.getElementById('bOverTitle');
  const unit = document.getElementById('bOverUnit');

  const rematchBtn = document.getElementById('bRematchBtn');
  const rematchMsg = document.getElementById('bRematchMsg');
  rematchMsg.classList.add('hidden');
  rematchMsg.textContent = '';
  if (msg.reason === 'disconnect') {
    rematchBtn.disabled = true;
    rematchMsg.classList.remove('hidden');
    rematchMsg.textContent = '相手との通信が切れたため、再戦はできません';
  } else {
    rematchBtn.disabled = false;
  }

  const REASON_TEXT = {
    timeout: iLost ? '時間切れで負けました' : '相手が時間切れ。あなたの勝ちです',
    give_up: iLost ? 'こうさんしました' : '相手がこうさん。あなたの勝ちです',
    disconnect: '相手との通信が切れました',
    exhausted: '出せる部首がなくなりました（引き分け）',
  };
  title.textContent = REASON_TEXT[msg.reason] || '対戦終了';
  unit.textContent = '';
  if (msg.reason === 'timeout' || msg.reason === 'give_up') {
    KBAudio.play(iLost ? 'timeup' : 'victory');
  }

  const box = document.getElementById('bReveal');
  if (!msg.reveal) {
    box.classList.add('hidden');
  } else {
    box.classList.remove('hidden');
    const { radical, unused, got } = msg.reveal;
    const d = DATA.radicals[radical];
    document.getElementById('bRevRad').textContent = radGlyph(radical);
    document.getElementById('bRevName').textContent = d.name;
    document.getElementById('bRevSub').textContent = d.meaning;
    setOriginBox('bRevOrigin', d.origin);
    revealAll.bRevGrid = false; // 前の試合で広げたままにしない

    if (!unused.length) {
      document.getElementById('bRevLead').innerHTML = `${radGlyph(radical)}を含む漢字は、すべて使われました`;
      renderRevealGrid('bRevGrid', 'bRevMore', got, radical, 'battleOverScreen');
      document.getElementById('bRevGot').innerHTML = '';
    } else {
      document.getElementById('bRevLead').innerHTML =
        `${radGlyph(radical)}を含む漢字は、まだ <b>${unused.length}</b> 字ありました`;
      const sorted = unused.slice().sort((a, b) =>
        (DATA.kanji[a] ? DATA.kanji[a].grade : 99) - (DATA.kanji[b] ? DATA.kanji[b].grade : 99));
      renderRevealGrid('bRevGrid', 'bRevMore', sorted, radical, 'battleOverScreen');
      document.getElementById('bRevGot').innerHTML = got.length
        ? '書かれたのは ' + got.map(k => `<span class="gk">${k}</span>`).join('') + ` の ${got.length} 字`
        : '';
    }
  }
  show('battleOverScreen');
}

function onBRematchRequested(msg) {
  if (msg.by === bstate.myId) return; // 自分の送信のエコーは無視（ボタン側で既に表示済み）
  const el = document.getElementById('bRematchMsg');
  el.classList.remove('hidden');
  el.textContent = '相手が再戦を希望しています！「再戦する」を押すと始まります';
}

function onBRematchDeclined() {
  document.getElementById('bRematchBtn').disabled = true;
  const el = document.getElementById('bRematchMsg');
  el.classList.remove('hidden');
  el.textContent = '相手が対戦を終了しました';
}

function bSetMsg(t, c) {
  const el = document.getElementById('bMsg');
  el.textContent = t; el.className = 'msg' + (c ? ' ' + c : '');
  if (c === 'ng') KBAudio.play('incorrect');
}

// サーバーが古い形式（漢字の文字列だけ）を返しても表示が壊れないようにする
function usedEntries() {
  return bstate.used.map(u => (typeof u === 'string' ? { kanji: u, by: null } : u));
}

function bRenderUsed() {
  const used = usedEntries();
  document.getElementById('bUsedCount').textContent = used.length + '字';
  // 新しく書いた字ほど左（先頭）に来るように、答えた順を逆にして並べる
  const mine = used.filter(u => u.by === bstate.myId).map(u => u.kanji).reverse();
  const theirs = used.filter(u => u.by !== bstate.myId).map(u => u.kanji).reverse();
  fillUsedLane('bUsedListMine', mine);
  fillUsedLane('bUsedListTheirs', theirs);
  bRenderUsedFocus();
}

// 使用済みがこの字数を超えたら、いま出題中の部首の分だけ抜き出して上に出す
const USED_FOCUS_FROM = 10;

function bRenderUsedFocus() {
  const box = document.getElementById('bUsedFocus');
  if (!bstate.radical || bstate.used.length < USED_FOCUS_FROM) { box.classList.add('hidden'); return; }
  const pool = new Set(poolOf(bstate.radical, ALL_GRADES));
  const hits = usedEntries().filter(u => pool.has(u.kanji)).map(u => u.kanji).reverse();
  if (!hits.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  document.getElementById('bUsedFocusRad').textContent = radGlyph(bstate.radical);
  document.getElementById('bUsedFocusList').innerHTML = hits.map(k => `<span>${k}</span>`).join('');
}

function fillUsedLane(id, kanjiList) {
  const el = document.getElementById(id);
  if (!kanjiList.length) { el.innerHTML = '<span class="usedempty">まだありません</span>'; return; }
  el.innerHTML = kanjiList.map(k => `<span>${k}</span>`).join('');
  el.scrollLeft = 0; // 新しい字が左端に来るので、常に先頭が見える位置に戻しておく
}

function bBind() {
  const BATTLE_PANEL = { friend: 'battleFriendPanel', quick: 'battleQuickPanel', create: 'battleCreatePanel', join: 'battleJoinPanel' };
  document.querySelectorAll('#battleChoice .bigbtn, #battleFriendPanel .bigbtn').forEach(b => {
    b.onclick = () => battleShowStep(BATTLE_PANEL[b.dataset.battle]);
  });
  document.querySelectorAll('#battleQuickPanel .bigbtn').forEach(b => {
    b.onclick = () => bQuickMatch(b.dataset.qlevel);
  });
  // 部屋コードは相手に伝えるものなので、手で打ち写さずに渡せるようにする
  bindCopyButton('copyRoomCodeBtn', () => bstate.code);
  document.getElementById('quickCancelBtn').onclick = () => {
    if (bstate.code && bstate.myId) Net.cancelRoom(bstate.code, bstate.myId);
    bReset();
  };
  document.querySelectorAll('#battleCreatePanel .bigbtn').forEach(b => {
    b.onclick = () => bCreateRoom(b.dataset.blevel);
  });
  document.getElementById('joinCodeBtn').onclick = () => {
    const code = document.getElementById('joinCodeInput').value.trim();
    if (code) bJoinRoom(code);
  };
  document.getElementById('battleBack').onclick = battleBackStep;

  document.getElementById('bRec').onclick = bJudge;
  document.getElementById('bErase').onclick = () => {
    KanjiCanvas.erase('canBattle');
    document.getElementById('bPicker').classList.add('hidden');
    bSetMsg('', '');
  };
  document.getElementById('bUndo').onclick = () => KanjiCanvas.deleteLast('canBattle');
  document.getElementById('bGiveUp').onclick = () => {
    if (bstate.isDefending) Net.send('give_up', {});
  };
  document.getElementById('bRematchBtn').onclick = () => {
    const btn = document.getElementById('bRematchBtn');
    const el = document.getElementById('bRematchMsg');
    btn.disabled = true;
    el.classList.remove('hidden');
    el.textContent = '相手の返事を待っています…';
    Net.send('rematch', {});
  };
  document.getElementById('bLeaveBtn').onclick = () => {
    Net.send('leave', {});
    Net.close();
    bReset();
    show('modeScreen');
  };
}
