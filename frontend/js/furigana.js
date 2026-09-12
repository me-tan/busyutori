"use strict";
/* 画面の文字にふりがなを振る。小学生が読めない漢字でつまずかないようにするため。
 *
 * 文言そのものに <ruby> を書き込むのではなく、「語と読みの辞書」を持って実行時に
 * 付ける方式にしている。画面の文言を書き直しても、辞書に載っている語なら自動で
 * ふりがなが付くので、文言を直すたびにルビを書き直さずに済む。
 * 辞書に無い語はふりがなが付かないだけで、表示は壊れない。
 *
 * 出題される漢字そのもの（書き取りの答えや使った漢字の一覧）には振らない。
 * 読みが見えると問題の答えになってしまうため、SKIP_SELECTORSで除いている。
 */
(function () {
  // 読みは「その語での読み方」。キーの先頭の漢字のまとまりにふりがなが乗り、
  // 残りの仮名（送り仮名）はそのまま表示される。
  // 同じ漢字で読みが変わるものは、送り仮名付きの長いキーを先に当てて見分ける
  //（例: 「消える」は「き」、「消す」は「け」）。
  const READINGS = {
    // 熟語
    '対戦相手': 'たいせんあいて', '対戦終了': 'たいせんしゅうりょう', '対戦': 'たいせん',
    '常用漢字': 'じょうようかんじ', '漢字': 'かんじ',
    '通信環境': 'つうしんかんきょう', '通信': 'つうしん',
    '効果音': 'こうかおん', '音量': 'おんりょう',
    '合言葉': 'あいことば', '時間切': 'じかんぎ',
    '文字以上': 'もじいじょう', '文字': 'もじ',
    '秒以内': 'びょういない', '範囲外': 'はんいがい', '起動中': 'きどうちゅう',
    '難易度': 'なんいど', '何連続': 'なんれんぞく', '連続': 'れんぞく',
    '一画戻': 'いっかくもど', '一度': 'いちど',
    '上級': 'じょうきゅう', '中級': 'ちゅうきゅう', '初級': 'しょきゅう', '中学': 'ちゅうがく',
    // 「音読み」を「音(おと)読み」と誤って振らないよう、2字のまとまりで登録する
    '音読': 'おんよ', '訓読': 'くんよ', '学年': 'がくねん', '画数': 'かくすう',
    '入力': 'にゅうりょく', '再戦': 'さいせん', '削除': 'さくじょ', '場合': 'ばあい',
    '変更': 'へんこう', '実行': 'じっこう', '専用': 'せんよう', '希望': 'きぼう',
    '承認': 'しょうにん', '最初': 'さいしょ', '本体': 'ほんたい', '正解': 'せいかい',
    '申請': 'しんせい', '画面': 'がめん', '発行': 'はっこう', '相手': 'あいて',
    '確認': 'かくにん', '端末': 'たんまつ', '終了': 'しゅうりょう', '練習': 'れんしゅう',
    '自分': 'じぶん', '記録': 'きろく', '設定': 'せってい', '認識': 'にんしき',
    '調節': 'ちょうせつ', '返事': 'へんじ', '追加': 'ついか', '送信': 'そうしん',
    '達成': 'たっせい', '部屋': 'へや', '部首': 'ぶしゅ', '開始': 'かいし',
    '分秒': 'ふんびょう',
    // 一字＋送り仮名。読みが分かれるものは長い方を先に書く
    '消え': 'き', '消': 'け',
    '分け': 'わ', '分': 'ふん',
    '次々': 'つぎつぎ', '次': 'つぎ',
    '伝': 'つた', '作': 'つく', '使': 'つか', '先': 'さき', '入': 'はい', '出': 'だ',
    '切': 'き', '別': 'べつ', '勝': 'か', '取': 'と', '名': 'めい', '含': 'ふく',
    '変': 'か', '大': 'おお', '始': 'はじ', '字': 'じ', '小': 'しょう', '少': 'すこ',
    '引': 'ひ', '待': 'ま', '忘': 'わす', '投': 'な', '押': 'お', '教': 'おし',
    '書': 'か', '残': 'のこ', '気': 'き', '番': 'ばん', '直': 'なお', '答': 'こた',
    '習': 'なら', '聞': 'き', '見': 'み', '試': 'ため', '認': 'みと', '誘': 'さそ',
    '読': 'よ', '負': 'ま', '込': 'こ', '送': 'おく', '選': 'えら', '開': 'ひら',
    '音': 'おと', '人': 'ひと', '中': 'ちゅう',
    // 単独の漢数字（ホーム画面の「一」「二」など）は、読めるうえに振ると
    // かえって読みにくいので辞書に入れない。「一度」「一画戻す」は上のキーで拾う。
  };

  // 長いキーから順に当てる（「対戦相手」を「対戦」＋「相手」に割らないため）
  const KEYS = Object.keys(READINGS).sort((a, b) => b.length - a.length);

  // ふりがなを振らない場所。出題・解答の漢字そのものと、書き換えると壊れるもの。
  const SKIP_SELECTORS = [
    'script', 'style', 'ruby', 'rt', 'textarea', 'input', 'canvas',
    '.furi', // 一度ふりがなを振った場所は触らない
    // 出題・解答として見せている漢字（--font-kanjiを使っている要素）
    '.radical', '.rad-name', '.usedlist', '.usedfocus-list', '.usedfocus-head',
    '.pick', '.kcell', '.radbtn', '.box', '.gotbox', '.reveal-rad',
    // 漢字辞書。読みは辞書自身が出すので、ふりがなを重ねない
    '.dkanji', '.dv', '.dwords', '.dread',
  ].join(',');

  const KANJI = /[一-龥々]/;

  function rubyHtml(text) {
    let out = '', i = 0, changed = false;
    while (i < text.length) {
      let hit = null;
      if (KANJI.test(text[i])) {
        for (const key of KEYS) {
          if (key.length <= text.length - i && text.startsWith(key, i)) { hit = key; break; }
        }
      }
      if (hit) {
        // キーの先頭の漢字部分にだけルビを乗せ、残りの送り仮名はそのまま出す
        let n = 0;
        while (n < hit.length && KANJI.test(hit[n])) n++;
        out += `<ruby>${escapeHtml(hit.slice(0, n))}<rt>${escapeHtml(READINGS[hit])}</rt></ruby>`;
        out += escapeHtml(hit.slice(n));
        i += hit.length;
        changed = true;
      } else {
        out += escapeHtml(text[i]);
        i++;
      }
    }
    return changed ? out : null;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function applyTo(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (!parent || parent.closest(SKIP_SELECTORS)) return;
      if (!KANJI.test(node.nodeValue)) return;
      const html = rubyHtml(node.nodeValue);
      if (!html) return;
      const span = document.createElement('span');
      span.className = 'furi';
      span.innerHTML = html;
      parent.replaceChild(span, node);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches && node.matches(SKIP_SELECTORS)) return;
    // 子を書き換えるので、先に配列にしてから回す
    for (const child of Array.from(node.childNodes)) applyTo(child);
  }

  const observer = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'childList') {
        for (const n of Array.from(r.addedNodes)) applyTo(n);
      } else if (r.type === 'characterData') {
        applyTo(r.target);
      }
    }
    // 自分の書き換えで積まれた分は捨てる（これをしないと際限なく呼ばれる）
    observer.takeRecords();
  });

  function start() {
    applyTo(document.body);
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
