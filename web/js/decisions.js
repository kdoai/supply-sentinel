// decisions.js — 人間承認ゲートの決定ストア + 承認キュー描画
//
// Supply Sentinel の安全設計の中心: AI は「起案」までしか行わず、
// 発注変更・サプライヤ切替・顧客通知・生産計画変更といった実務アクションは
// 必ず人の承認(承認/差戻し/保留)を経る。本モジュールはその承認状態を
// localStorage に永続化し、承認キューUIを描画する。
//
// 状態は decision.id ごとに localStorage キー 'supply-sentinel.decisions' に
// { [decisionId]: state } の JSON マップとして保存する。localStorage が
// 使えない環境(SSR・プライバシーモード等)でも例外を投げないよう、
// 失敗時はメモリ上のフォールバックへ自動的に縮退する。
//
// 純粋/オフライン: モジュール読込時にネットワークへアクセスしない。
// 壁時計(Date.now)も読まない — 表示は与えられたデータのみで決まる。

const STORAGE_KEY = "supply-sentinel.decisions";

// 取り得る状態(人間承認: pending/approved/rejected/hold、AI自動: auto)
const VALID_STATES = new Set(["pending", "approved", "rejected", "hold", "auto"]);

// 状態 → 日本語ラベル(キューのバッジ表示用)
const STATE_LABELS = {
  pending: "承認待ち",
  approved: "承認済み",
  rejected: "差戻し",
  hold: "保留",
  auto: "AI実行済み",
};

// localStorage が利用不可な場合に使うメモリ上のフォールバックストア。
// 一度フォールバックへ切り替わると、その後は一貫してメモリを使う。
let memoryStore = null;

// HTML へ差し込む文字列のエスケープ(各モジュールが自前で持つ慣習に従う)
function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// localStorage が安全に使えるかを判定する。参照自体が throw する環境
// (一部ブラウザのプライバシーモード等)も考慮して try/catch で包む。
function storageAvailable() {
  try {
    return typeof localStorage !== "undefined" && localStorage !== null;
  } catch {
    return false;
  }
}

// 永続化マップ全体を読み出す。常にプレーンなオブジェクトを返し、
// 失敗時はメモリフォールバックを使うので決して throw しない。
function readMap() {
  if (storageAvailable()) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      // 配列や null ではなくプレーンオブジェクトのみ採用する。
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
      return {};
    } catch {
      // パース不能・読出失敗 → 以降はメモリへ縮退。
      if (!memoryStore) memoryStore = {};
      return memoryStore;
    }
  }
  if (!memoryStore) memoryStore = {};
  return memoryStore;
}

// 永続化マップ全体を書き戻す。localStorage が使えない/書込に失敗した場合は
// メモリフォールバックへ保存し、例外は外へ漏らさない。
function writeMap(map) {
  if (storageAvailable()) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
      return;
    } catch {
      // 容量超過・書込不可など → メモリへ縮退。
    }
  }
  memoryStore = map;
}

// --- 公開API ---------------------------------------------------------------

// 指定IDの現在状態を返す。保存値が無ければ 'pending'(=人間承認の既定)。
// 不正な保存値が紛れていた場合も安全側で 'pending' に倒す。
export function getState(id) {
  const map = readMap();
  const stored = map[id];
  if (typeof stored === "string" && VALID_STATES.has(stored)) {
    return stored;
  }
  return "pending";
}

// 指定IDの状態を永続化する。未知の状態が来た場合は無視して書き込まない。
export function setState(id, state) {
  if (id == null || !VALID_STATES.has(state)) return;
  const map = readMap();
  map[String(id)] = state;
  writeMap(map);
}

// 1回の実行(runId)に属する決定の保存状態を破棄する。
// id が runId で始まるものだけを忘れ、他の実行の状態は保持する。
export function clearRun(runId) {
  if (runId == null) return;
  const prefix = String(runId);
  const map = readMap();
  let changed = false;
  for (const key of Object.keys(map)) {
    if (key.startsWith(prefix)) {
      delete map[key];
      changed = true;
    }
  }
  if (changed) writeMap(map);
}

// decision の既定状態を返す。requires_human の項目は 'pending'、
// AI自動の項目は 'auto'。default_state があればそれを優先するが、
// 妥当な値でなければ requires_human から導出する。
function defaultStateFor(decision) {
  const d = decision || {};
  if (typeof d.default_state === "string" && VALID_STATES.has(d.default_state)) {
    return d.default_state;
  }
  return d.requires_human ? "pending" : "auto";
}

// 保存値が無ければ既定状態を用いて、この decision の実効状態を返す。
function effectiveState(decision) {
  const d = decision || {};
  const map = readMap();
  const stored = map[d.id];
  if (typeof stored === "string" && VALID_STATES.has(stored)) {
    return stored;
  }
  return defaultStateFor(d);
}

// run 全体の承認状況を集計する。onChange に渡すサマリと同形。
//   total:    決定総数
//   human:    人間承認を要する件数
//   approved/rejected/hold/pending: 人間承認項目の状態別件数
//   auto:     AI自動(ドラフトのみ)件数
export function summary(run) {
  const decisions = asArray((run || {}).decisions);
  const result = {
    total: decisions.length,
    human: 0,
    approved: 0,
    rejected: 0,
    hold: 0,
    pending: 0,
    auto: 0,
  };
  for (const decision of decisions) {
    if (decision && decision.requires_human) {
      result.human += 1;
      const state = effectiveState(decision);
      // 人間承認項目の実効状態は pending/approved/rejected/hold のいずれか。
      if (state === "approved") result.approved += 1;
      else if (state === "rejected") result.rejected += 1;
      else if (state === "hold") result.hold += 1;
      else result.pending += 1;
    } else {
      result.auto += 1;
    }
  }
  return result;
}

// --- 描画 -------------------------------------------------------------------

// 人間承認1項目分のカードを生成する。状態に応じたクラスとアクティブな
// ボタンを付与し、data-* 属性でイベント委譲時に参照できるようにする。
function humanCardHtml(decision, state) {
  const approver = decision.requires_human && decision.approver
    ? `<span class="decision-approver">承認者: ${esc(decision.approver)}</span>`
    : "";
  const why = decision.ai_recommendation
    ? `<p class="decision-why">${esc(decision.ai_recommendation)}</p>`
    : "";

  // 各ボタン: 現在状態と一致するものに .is-active を付与して選択を可視化。
  const btn = (action, targetState, label, extraClass) => {
    const active = state === targetState ? " is-active" : "";
    return `<button type="button" class="decision-btn ${extraClass}${active}" data-action="${esc(action)}">${esc(label)}</button>`;
  };

  return `
    <div class="decision-card is-${esc(state)}" data-decision-id="${esc(decision.id)}">
      <div class="decision-main">
        <strong class="decision-title">${esc(decision.title)}</strong>
        ${approver}
      </div>
      ${why}
      <div class="decision-actions">
        ${btn("approve", "approved", "承認", "decision-btn-approve")}
        ${btn("reject", "rejected", "差戻し", "decision-btn-reject")}
        ${btn("hold", "hold", "保留", "decision-btn-hold")}
        <span class="decision-state">${esc(STATE_LABELS[state] || STATE_LABELS.pending)}</span>
      </div>
    </div>`;
}

// AI自動(ドラフトのみ)1項目分のカードを生成する。実行ボタンは置かず、
// 「AI実行済み(ドラフト)」バッジで人間承認が不要な範囲であることを示す。
function autoCardHtml(decision) {
  const why = decision.ai_recommendation
    ? `<p class="decision-why">${esc(decision.ai_recommendation)}</p>`
    : "";
  return `
    <div class="decision-card is-auto" data-decision-id="${esc(decision.id)}">
      <div class="decision-main">
        <strong class="decision-title">${esc(decision.title)}</strong>
      </div>
      ${why}
      <span class="decision-auto">AI実行済み(ドラフト)</span>
    </div>`;
}

function decisionOutputPanelHtml(run) {
  const agents = asArray((run || {}).agents);
  const impactAgent = agents.find((agent) => agent && agent.key === "impact_mapper") || {};
  const products = asArray(impactAgent.impacted_products);
  const protect = products[0] || "影響製品なし";
  const allocation = products[1] || "供給配分候補なし";
  const reduce = products[2] || "縮小候補なし";
  const approvals = asArray((run || {}).decisions).filter((decision) => decision && decision.requires_human);
  return `
    <div class="decision-output-grid">
      <section>
        <span>今すぐ判断</span>
        <strong>${esc(protect)}を優先保護</strong>
        <p>${esc(allocation)}は供給配分候補、${esc(reduce)}は縮小・代替材確認候補として扱います。</p>
      </section>
      <section>
        <span>事前準備</span>
        <strong>代替材・在庫・調達先分散</strong>
        <p>代替材承認プロセス開始、在庫積み増し検討、高優先顧客への事前説明準備を起案します。</p>
      </section>
      <section>
        <span>継続監視</span>
        <strong>価格・港湾・サプライヤ通知</strong>
        <p>価格変動、港湾遅延、追加通知を次回の市場監視で再評価します。</p>
      </section>
      <section>
        <span>人間承認が必要</span>
        <strong>${esc(approvals.length)}件を承認キューへ</strong>
        <p>発注変更、サプライヤ切替、顧客正式通知、生産計画変更、配分・縮小判断はAIが実行しません。</p>
      </section>
    </div>`;
}

// action(approve/reject/hold)→ 保存する状態名へのマップ。
const ACTION_TO_STATE = {
  approve: "approved",
  reject: "rejected",
  hold: "hold",
};

// 承認キューを containerEl に描画する。
//   run     : model.agent_run
//   options : { onChange(summary) } — 状態変更後と初回描画直後に呼ばれる
//
// 冪等: 再呼び出し時は containerEl を一度クリアしてから組み直す。
// イベントは生成し直したボタンへ addEventListener で束ねる(inline禁止)。
export function renderDecisionQueue(containerEl, run, options) {
  if (!containerEl) return;
  const opts = options || {};
  const decisions = asArray((run || {}).decisions);

  // 状態変更後・初回描画後に呼ぶ通知。onChange が無くても安全。
  const notify = () => {
    if (typeof opts.onChange === "function") {
      opts.onChange(summary(run));
    }
  };

  // 冪等性のため既存内容を必ずクリアしてから組み直す。
  containerEl.innerHTML = "";

  const lead = `<p class="decision-lead">AIは市場予兆の抽出、シナリオ化、影響説明、打ち手起案まで。発注変更・サプライヤ切替・顧客通知・生産計画変更は人の承認が必要です。</p>`;

  const cards = decisions
    .map((decision) => {
      if (!decision) return "";
      if (decision.requires_human) {
        return humanCardHtml(decision, effectiveState(decision));
      }
      return autoCardHtml(decision);
    })
    .join("");

  containerEl.innerHTML = decisionOutputPanelHtml(run) + lead + `<div class="decision-queue">${cards}</div>`;

  // 生成済みの承認ボタンへイベントを束ねる(inline ハンドラは使わない)。
  const buttons = containerEl.querySelectorAll(".decision-actions .decision-btn");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const card = button.closest(".decision-card");
      if (!card) return;
      const id = card.getAttribute("data-decision-id");
      const action = button.getAttribute("data-action");
      const nextState = ACTION_TO_STATE[action];
      if (!id || !nextState) return;

      setState(id, nextState);
      // フル再描画で受理: カードのクラス・状態ラベル・アクティブ表示を
      // 一括で確実に更新する(部分更新より破綻しにくい)。
      renderDecisionQueue(containerEl, run, opts);
    });
  });

  // 初回描画(および各再描画)直後に現在のサマリを通知する。
  notify();
}
