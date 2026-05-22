(function () {
  const vscode = acquireVsCodeApi();

  const els = {
    scriptPath: document.getElementById("script-path"),
    targetPath: document.getElementById("target-path"),
    chunks: document.getElementById("chunks"),
    empty: document.getElementById("empty"),
    detachBtn: document.getElementById("detach-btn"),
    newScriptBtn: document.getElementById("new-script-btn"),
    modeSelect: document.getElementById("mode-select"),
    wpmSlider: document.getElementById("wpm-slider"),
    wpmValue: document.getElementById("wpm-value"),
    jitterCheckbox: document.getElementById("jitter-checkbox"),
    playNextBtn: document.getElementById("play-next-btn"),
    pauseBtn: document.getElementById("pause-btn"),
    stopBtn: document.getElementById("stop-btn"),
    resetBtn: document.getElementById("reset-btn"),
  };

  let state = null;

  function send(msg) {
    vscode.postMessage(msg);
  }

  function currentSettings() {
    return {
      mode: els.modeSelect.value,
      wpm: parseInt(els.wpmSlider.value, 10),
      jitter: els.jitterCheckbox.checked,
      lineDelayMs: 120,
    };
  }

  function renderState(next) {
    state = next;

    els.scriptPath.textContent = next.scriptPath ?? "(none open)";
    els.targetPath.textContent = next.targetPath ?? "(click into a code file)";

    if (next.settings) {
      if (els.modeSelect.value !== next.settings.mode) els.modeSelect.value = next.settings.mode;
      if (parseInt(els.wpmSlider.value, 10) !== next.settings.wpm) {
        els.wpmSlider.value = String(next.settings.wpm);
        els.wpmValue.textContent = String(next.settings.wpm);
      }
      if (els.jitterCheckbox.checked !== next.settings.jitter) els.jitterCheckbox.checked = next.settings.jitter;
    }

    const hasChunks = next.chunks && next.chunks.length > 0;
    const hasScript = !!next.scriptPath;
    els.empty.classList.toggle("hidden", hasScript);
    els.chunks.classList.toggle("hidden", !hasChunks);

    els.chunks.innerHTML = "";
    if (hasChunks) {
      for (const chunk of next.chunks) {
        const card = document.createElement("div");
        card.className = "chunk-card";
        if (chunk.played) card.classList.add("played");
        if (next.playingChunkIndex === chunk.index) card.classList.add("playing");

        const playBtn = document.createElement("button");
        playBtn.className = "play-btn";
        playBtn.textContent = chunk.played ? "↻" : "▶";
        playBtn.title = chunk.played ? "Replay this chunk" : "Play this chunk";
        playBtn.addEventListener("click", () => send({ type: "playChunk", index: chunk.index }));

        const idx = document.createElement("span");
        idx.className = "chunk-index";
        idx.textContent = String(chunk.index + 1);

        const preview = document.createElement("span");
        preview.className = "chunk-preview";
        preview.textContent = chunk.preview || "(empty)";

        const status = document.createElement("span");
        status.className = "chunk-status";
        status.textContent = chunk.played ? "played" : "";

        card.appendChild(playBtn);
        card.appendChild(idx);
        card.appendChild(preview);
        card.appendChild(status);
        els.chunks.appendChild(card);
      }
    }

    const playing = next.status === "playing";
    const paused = next.status === "paused";
    els.playNextBtn.disabled = !hasChunks || playing || paused;
    els.pauseBtn.disabled = !playing && !paused;
    els.pauseBtn.textContent = paused ? "▶ Resume" : "⏸ Pause";
    els.stopBtn.disabled = !playing && !paused;
  }

  function renderProgress(update) {
    const cards = els.chunks.querySelectorAll(".chunk-card");
    cards.forEach((card, idx) => card.classList.toggle("playing", idx === update.chunkIndex && update.status === "playing"));
    if (update.status === "playing" || update.status === "paused") {
      const card = cards[update.chunkIndex];
      if (card) {
        const statusEl = card.querySelector(".chunk-status");
        const pct = update.chunkLength === 0 ? 0 : Math.round((update.positionInChunk / update.chunkLength) * 100);
        if (statusEl) statusEl.textContent = `${pct}%`;
      }
    }
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "state") renderState(msg.state);
    else if (msg.type === "progress") renderProgress(msg.update);
  });

  els.detachBtn.addEventListener("click", () => send({ type: "detach" }));
  els.newScriptBtn.addEventListener("click", () => send({ type: "newScript" }));
  els.playNextBtn.addEventListener("click", () => send({ type: "playNext" }));
  els.pauseBtn.addEventListener("click", () => send({ type: "pauseResume" }));
  els.stopBtn.addEventListener("click", () => send({ type: "stop" }));
  els.resetBtn.addEventListener("click", () => send({ type: "reset" }));

  els.modeSelect.addEventListener("change", () => send({ type: "settingsChanged", settings: currentSettings() }));
  els.jitterCheckbox.addEventListener("change", () => send({ type: "settingsChanged", settings: currentSettings() }));
  els.wpmSlider.addEventListener("input", () => {
    els.wpmValue.textContent = els.wpmSlider.value;
  });
  els.wpmSlider.addEventListener("change", () => send({ type: "settingsChanged", settings: currentSettings() }));

  send({ type: "ready" });
})();
