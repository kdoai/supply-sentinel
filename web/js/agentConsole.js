// agentConsole.js — Agent Run Console (the demo centerpiece).
//
// Renders `model.agent_run` as a constrained autonomous multi-agent trace:
//   header (run_id / model / run_mode / persist + summary line)
//   → vertical agents timeline (status dot, processor badge, input→output, times)
//   → tool-call log (HH:MM:SS  tool  result)
//   → blocked_evidence section (prompt-injection excluded as DATA not instructions).
// Clicking an agent opens a detail modal with its full input/output/tools/extras.
// play() runs a theatrical replay that reveals agents one-by-one, marking each
// running→completed, appending its tool lines, and emitting `agent-console-step`
// so the page can highlight the related panel.
//
// Pure / deterministic: every timestamp comes from the data (started_hms / ts),
// never the wall-clock. No network at module load. No external libraries.
//
// API: createAgentConsole(containerEl) -> { render(model), play(opts), stop(), isPlaying() }
//      agentConsoleLegendHtml() -> string

// Minimal local HTML escaper (each module owns its own trivial helpers).
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

// Localized labels for run_mode / persistence badges.
const RUN_MODE_LABELS = {
  cloud: "Azure OpenAI ライブ",
  demo: "デモ抽出(決定論)",
};

// Maps a tool-call's `agent` field (agent.key) so we can group lines during replay.
// The contract keys are stable, but we never assume a fixed roster size.

export function createAgentConsole(containerEl) {
  // Resolved lazily so the module is importable in non-DOM contexts (node --check).
  const doc = typeof document !== "undefined" ? document : null;

  let model = null; // last rendered model
  let run = null; // model.agent_run shortcut

  // Replay state.
  let playing = false;
  let timers = []; // outstanding setTimeout handles (so stop() can clear them all)
  let playToken = 0; // bumped on every play()/stop() to invalidate stale timers

  // Persistent modal element (built once, reused across renders).
  let modalEl = null;
  let modalBodyEl = null;
  let escHandler = null;

  // ---- Header ---------------------------------------------------------------

  function headerHtml(ar) {
    const runMode = ar.run_mode === "cloud" ? "cloud" : "demo";
    const modeLabel = RUN_MODE_LABELS[runMode] || RUN_MODE_LABELS.demo;
    const modeClass = runMode === "cloud" ? "agentrun-badge-cloud" : "agentrun-badge-demo";
    const persistLabel = ar.persisted ? "Cosmos保存済み" : "ローカル保存";

    const stats = ar.stats || {};
    const agents = asArray(ar.agents);
    const agentCount = stats.agent_count ?? agents.length;
    const toolCount = stats.tool_call_count ?? asArray(ar.tool_calls).length;
    // 完了時刻は最後のエージェントの completed_hms から取る(壁時計は読まない)。
    const lastAgent = agents[agents.length - 1] || {};
    const completedHms = lastAgent.completed_hms || "--:--:--";

    return `
      <div class="agentrun-head">
        <div class="agentrun-meta">
          <span class="agentrun-badge">${esc(ar.run_id || "run-unknown")}</span>
          <span class="agentrun-badge">${esc(ar.model || "gpt-5.4-mini")}</span>
          <span class="agentrun-badge ${modeClass}">${esc(modeLabel)}</span>
          <span class="agentrun-badge agentrun-badge-persist">${esc(persistLabel)}</span>
        </div>
        <div class="agentrun-meta">
          <span>${esc(agentCount)}エージェント / ${esc(toolCount)} tool calls / 完了 ${esc(completedHms)}</span>
        </div>
      </div>`;
  }

  // ---- Agents timeline ------------------------------------------------------

  function agentRowHtml(agent, index) {
    // Static render: every agent is completed. Replay overrides the state class.
    const stateClass = stateClassFor(agent.status || "completed");
    const proc = agent.processor_label || agent.processor || "";
    const procBadge = proc
      ? `<span class="agentrun-agent-proc">${esc(proc)}</span>`
      : "";
    const time = `${esc(agent.started_hms || "--:--:--")}→${esc(agent.completed_hms || "--:--:--")}`;

    return `
      <div class="agentrun-agent ${stateClass}" data-agent-index="${esc(index)}" data-agent-key="${esc(agent.key || "")}" role="button" tabindex="0" style="cursor:pointer;">
        <span class="agentrun-agent-dot" aria-hidden="true"></span>
        <div class="agentrun-agent-head">
          <span class="agentrun-agent-name">${esc(agent.name || agent.key || "エージェント")}</span>
          ${procBadge}
          <span class="agentrun-agent-time">${time}</span>
        </div>
        <div class="agentrun-agent-io">
          <span>${esc(agent.input || "")}</span>
          <span class="agentrun-agent-arrow" aria-hidden="true">→</span>
          <span>${esc(agent.output || "")}</span>
        </div>
      </div>`;
  }

  // Maps a status string to its state class.
  function stateClassFor(status) {
    switch (status) {
      case "pending":
        return "is-pending";
      case "running":
        return "is-running";
      case "failed":
        return "is-failed";
      case "completed":
      default:
        return "is-completed";
    }
  }

  function agentsHtml(agents) {
    return `
      <div class="agentrun-agents">
        ${agents.map((a, i) => agentRowHtml(a, i)).join("")}
      </div>`;
  }

  // ---- Tool-call log --------------------------------------------------------

  function toolLineHtml(call) {
    const errorClass = call.ok === false ? " is-error" : "";
    return `
      <div class="agentrun-tool${errorClass}" data-tool-agent="${esc(call.agent || "")}">
        <span class="agentrun-tool-ts">${esc(call.ts || "--:--:--")}</span>
        <span class="agentrun-tool-name">${esc(call.tool || "")}</span>
        <span class="agentrun-tool-result">${esc(call.result || "")}</span>
      </div>`;
  }

  function toolsHtml(toolCalls) {
    const lines = toolCalls.map(toolLineHtml).join("");
    return `
      <div class="agentrun-tools">
        <div class="agentrun-toolhead">ツール実行ログ</div>
        ${lines}
      </div>`;
  }

  // ---- Blocked evidence (prompt-injection) ----------------------------------

  function blockedHtml(blocked) {
    if (!blocked.length) return "";
    const cards = blocked
      .map(
        (b) => `
          <div class="agentrun-blocked-card">
            <div class="agentrun-meta">
              <span class="agentrun-badge">${esc(b.source || "外部ソース")}</span>
              <span class="agentrun-badge">${esc(b.kind || "unknown")}</span>
            </div>
            <p>${esc(b.text || "")}</p>
            <p>${esc(b.reason || "")}</p>
            <p><strong>観測データとして扱い、指示としては実行しない</strong></p>
          </div>`,
      )
      .join("");
    return `
      <div class="agentrun-blocked">
        <div class="agentrun-toolhead">除外された命令文(プロンプトインジェクション対策)</div>
        ${cards}
      </div>`;
  }

  // ---- Detail modal ---------------------------------------------------------

  function ensureModal() {
    if (!doc || modalEl) return;
    modalEl = doc.createElement("div");
    modalEl.className = "agentrun-modal";
    modalEl.setAttribute("role", "dialog");
    modalEl.setAttribute("aria-modal", "true");
    modalEl.innerHTML = `
      <div class="agentrun-modal-card">
        <button type="button" class="agentrun-modal-close" aria-label="閉じる">×</button>
        <div class="agentrun-modal-body"></div>
      </div>`;
    modalBodyEl = modalEl.querySelector(".agentrun-modal-body");

    // Close on the × button.
    modalEl
      .querySelector(".agentrun-modal-close")
      .addEventListener("click", closeModal);

    // Close on backdrop click (but not when clicking inside the card).
    modalEl.addEventListener("click", (ev) => {
      if (ev.target === modalEl) closeModal();
    });

    // Append to the container if possible, else document.body.
    const host = containerEl || doc.body;
    host.appendChild(modalEl);
  }

  // Renders a labelled list section only when there are items.
  function modalListSection(label, items) {
    const arr = asArray(items);
    if (!arr.length) return "";
    const lis = arr
      .map((item) => `<li>${esc(modalItemText(item))}</li>`)
      .join("");
    return `<section><h4>${esc(label)}</h4><ul>${lis}</ul></section>`;
  }

  // Flattens a possibly-structured extra item to a single display string.
  function modalItemText(item) {
    if (item == null) return "";
    if (typeof item === "string" || typeof item === "number") return String(item);
    // evidence[] entries: { kind, claim, source } ; blocked_evidence: { source, kind, text }
    if (item.claim) {
      return `${item.kind ? `[${item.kind}] ` : ""}${item.claim}${item.source ? ` — ${item.source}` : ""}`;
    }
    if (item.text) {
      return `${item.source ? `${item.source}: ` : ""}${item.text}`;
    }
    // decisions[] entries: { title, approver, requires_human }
    if (item.title) {
      const gate = item.requires_human ? "要承認" : "AI実行可";
      return `${item.title}${item.approver ? ` (承認: ${item.approver})` : ""} — ${gate}`;
    }
    return JSON.stringify(item);
  }

  function openModal(agent) {
    if (!doc) return;
    ensureModal();
    if (!modalEl || !modalBodyEl) return;

    const proc = agent.processor_label || agent.processor || "";
    const tools = asArray(agent.tools);
    const toolList = tools.length
      ? `<section><h4>使用ツール</h4><ul>${tools
          .map((t) => `<li>${esc(t)}</li>`)
          .join("")}</ul></section>`
      : "";

    modalBodyEl.innerHTML = `
      <div class="agentrun-meta">
        <span class="agentrun-badge">${esc(agent.key || "")}</span>
        ${proc ? `<span class="agentrun-agent-proc">${esc(proc)}</span>` : ""}
        <span>${esc(agent.started_hms || "--:--:--")}→${esc(agent.completed_hms || "--:--:--")}</span>
      </div>
      <h3>${esc(agent.name || agent.key || "エージェント")}</h3>
      ${agent.role ? `<p>${esc(agent.role)}</p>` : ""}
      <section><h4>入力</h4><p>${esc(agent.input || "—")}</p></section>
      <section><h4>出力</h4><p>${esc(agent.output || "—")}</p></section>
      ${toolList}
      ${modalListSection("検証根拠", agent.evidence)}
      ${modalListSection("除外された命令文", agent.blocked_evidence)}
      ${modalListSection("影響製品", agent.impacted_products)}
      ${modalListSection("影響顧客", agent.impacted_customers)}
      ${modalListSection("影響工場", agent.impacted_plants)}
      ${modalListSection("推奨初動", agent.recommended_actions)}
      ${modalListSection("意思決定", agent.decisions)}`;

    modalEl.classList.add("is-open");

    // Escape closes the modal (registered while open, removed on close).
    if (!escHandler) {
      escHandler = (ev) => {
        if (ev.key === "Escape") closeModal();
      };
      doc.addEventListener("keydown", escHandler);
    }
  }

  function closeModal() {
    if (modalEl) modalEl.classList.remove("is-open");
    if (doc && escHandler) {
      doc.removeEventListener("keydown", escHandler);
      escHandler = null;
    }
  }

  // ---- Event wiring (delegated on the agents container) ---------------------

  function wireAgentRows() {
    if (!containerEl) return;
    const rows = containerEl.querySelectorAll(".agentrun-agent");
    rows.forEach((row) => {
      const index = Number(row.getAttribute("data-agent-index"));
      const agent = asArray(run && run.agents)[index];
      if (!agent) return;
      row.addEventListener("click", () => openModal(agent));
      row.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          openModal(agent);
        }
      });
    });
  }

  // ---- Public: render -------------------------------------------------------

  function render(nextModel) {
    if (nextModel !== undefined) model = nextModel;
    run = (model && model.agent_run) || null;

    // Stop any in-flight replay so we don't leave dangling timers.
    stop({ silent: true });

    if (!containerEl) return;

    const agents = asArray(run && run.agents);
    if (!run || !agents.length) {
      containerEl.innerHTML = `
        <div class="agentrun">
          <p class="empty">エージェント実行トレースがありません</p>
        </div>`;
      return;
    }

    const toolCalls = asArray(run.tool_calls);
    const blocked = asArray(run.blocked_evidence);

    containerEl.innerHTML = `
      <div class="agentrun">
        ${headerHtml(run)}
        ${agentsHtml(agents)}
        ${toolsHtml(toolCalls)}
        ${blockedHtml(blocked)}
      </div>`;

    wireAgentRows();
    // The persistent modal lives alongside (re)created on demand; re-attach if lost.
    if (modalEl && containerEl && modalEl.parentNode !== containerEl && !doc?.body?.contains(modalEl)) {
      containerEl.appendChild(modalEl);
    }
  }

  // ---- Public: play (theatrical replay) -------------------------------------

  function play(opts) {
    if (!containerEl || !run) {
      render();
      return;
    }
    const agents = asArray(run.agents);
    if (!agents.length) {
      render();
      return;
    }
    // Re-entrancy guard: a fresh play() always restarts cleanly.
    stop({ silent: true });

    const stepMs = Math.max(1, Number(opts && opts.stepMs) || 720);
    playing = true;
    const token = ++playToken;

    // Reset DOM: agents → pending, tool lines hidden until their agent runs.
    const rows = containerEl.querySelectorAll(".agentrun-agent");
    rows.forEach((row) => {
      row.classList.remove("is-running", "is-completed", "is-failed");
      row.classList.add("is-pending");
    });
    const toolLines = containerEl.querySelectorAll(".agentrun-tool");
    toolLines.forEach((line) => {
      line.style.display = "none";
    });

    // Reveal agents one-by-one on the timer.
    agents.forEach((agent, index) => {
      // Start of this agent's step: mark running + reveal its tool lines + emit event.
      const startT = window.setTimeout(() => {
        if (token !== playToken) return; // stale timer (stopped/replaced)
        const row = rows[index];
        if (row) {
          row.classList.remove("is-pending");
          row.classList.add("is-running");
          scrollRowIntoView(row);
        }
        revealAgentTools(agent, index);
        containerEl.dispatchEvent(
          new CustomEvent("agent-console-step", {
            detail: { agentKey: agent.key, index, agent },
          }),
        );
      }, index * stepMs);
      timers.push(startT);

      // End of this agent's step: mark completed.
      const endT = window.setTimeout(() => {
        if (token !== playToken) return;
        const row = rows[index];
        if (row) {
          row.classList.remove("is-running");
          row.classList.add(agent.status === "failed" ? "is-failed" : "is-completed");
        }
      }, index * stepMs + stepMs * 0.9);
      timers.push(endT);
    });

    // After the last step, settle into the fully-completed state + emit done.
    const doneT = window.setTimeout(() => {
      if (token !== playToken) return;
      finalizeReplay();
      playing = false;
      containerEl.dispatchEvent(new CustomEvent("agent-console-done", { detail: { run_id: run.run_id } }));
    }, agents.length * stepMs + 40);
    timers.push(doneT);
  }

  // Reveals every tool-call line belonging to the given agent key.
  function revealAgentTools(agent, index) {
    if (!containerEl) return;
    const key = agent.key || "";
    const lines = containerEl.querySelectorAll(`.agentrun-tool[data-tool-agent="${cssEscape(key)}"]`);
    lines.forEach((line) => {
      line.style.display = "";
    });
    // Keep the latest revealed line in view.
    const last = lines[lines.length - 1];
    if (last) scrollRowIntoView(last);
  }

  // Settles every row to completed and reveals all tool lines (final state).
  function finalizeReplay() {
    if (!containerEl) return;
    const rows = containerEl.querySelectorAll(".agentrun-agent");
    const agents = asArray(run && run.agents);
    rows.forEach((row, i) => {
      row.classList.remove("is-pending", "is-running");
      const status = agents[i] && agents[i].status === "failed" ? "is-failed" : "is-completed";
      row.classList.add(status);
    });
    const toolLines = containerEl.querySelectorAll(".agentrun-tool");
    toolLines.forEach((line) => {
      line.style.display = "";
    });
  }

  // Best-effort smooth scroll; harmless in non-DOM/jsdom contexts.
  function scrollRowIntoView(row) {
    if (row && typeof row.scrollIntoView === "function") {
      try {
        row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch {
        /* scrollIntoView options unsupported — ignore */
      }
    }
  }

  // Minimal CSS attribute-value escaper for our querySelector lookups.
  function cssEscape(value) {
    if (doc && doc.defaultView && typeof doc.defaultView.CSS?.escape === "function") {
      return doc.defaultView.CSS.escape(value);
    }
    return String(value).replace(/["\\\]]/g, "\\$&");
  }

  // ---- Public: stop ---------------------------------------------------------

  function stop(opts) {
    const silent = opts && opts.silent;
    // Invalidate any outstanding timers, then clear them.
    playToken++;
    for (const t of timers) window.clearTimeout(t);
    timers = [];
    const wasPlaying = playing;
    playing = false;
    // Jump straight to the fully-rendered (all-completed) state.
    if (containerEl && run) finalizeReplay();
    if (wasPlaying && !silent && containerEl) {
      containerEl.dispatchEvent(new CustomEvent("agent-console-done", { detail: { run_id: run && run.run_id, stopped: true } }));
    }
  }

  function isPlaying() {
    return playing;
  }

  return { render, play, stop, isPlaying };
}

// Tiny legend explaining the three replay states (pending / running / completed).
export function agentConsoleLegendHtml() {
  const items = [
    ["is-pending", "待機"],
    ["is-running", "実行中"],
    ["is-completed", "完了"],
  ];
  return items
    .map(
      (i) =>
        `<span class="agentrun-agent ${i[0]}" style="display:inline-flex;"><span class="agentrun-agent-dot" aria-hidden="true"></span>${i[1]}</span>`,
    )
    .join("");
}
