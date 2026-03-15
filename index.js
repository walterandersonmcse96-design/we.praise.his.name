(() => {
  const els = {
    pdfFile: document.getElementById("pdfFile"),
    gridSize: document.getElementById("gridSize"),
    wordCount: document.getElementById("wordCount"),
    extractBtn: document.getElementById("extractBtn"),
    extractStatus: document.getElementById("extractStatus"),
    sourceText: document.getElementById("sourceText"),
    analyzeBtn: document.getElementById("analyzeBtn"),
    analysisStatus: document.getElementById("analysisStatus"),
    generateBtn: document.getElementById("generateBtn"),
    generateStatus: document.getElementById("generateStatus"),
    wordBank: document.getElementById("wordBank"),
    crosswordGrid: document.getElementById("crosswordGrid"),
    acrossClues: document.getElementById("acrossClues"),
    downClues: document.getElementById("downClues"),
    downloadBtn: document.getElementById("downloadBtn")
  };

  const state = {
    extractedText: "",
    candidateWords: [],
    sentences: [],
    puzzle: null
  };

  const STOP_WORDS = new Set([
    "THE","AND","FOR","ARE","WITH","THIS","THAT","FROM","YOUR","HAVE","WILL","THEY","INTO","THERE",
    "ABOUT","WHICH","WHEN","WHERE","WHAT","THOSE","THESE","THAN","THEN","WERE","BEING","BEEN","HAD",
    "HAS","HAVE","YOU","HIS","HER","ITS","OUR","OUT","NOT","CAN","ALL","ANY","MAY","USE","ONE","TWO",
    "THREE","FOUR","FIVE","FIRST","SECOND","NEW","MORE","MOST","OVER","UNDER","VERY","MUCH","SOME",
    "EACH","OTHER","ALSO","ONLY","SUCH","LIKE","JUST","TEXT","PAGE","PAGES","INFORMATION","DOCUMENT",
    "VERSION","LATEST","STABLE","INSTALL","PLEASE","SELECT","DOMAIN","CUSTOM","SITE","USERNAME","PASSWORD"
  ]);

  function setStatus(el, text, isError = false) {
    el.textContent = text;
    el.style.color = isError ? "#a12626" : "";
    el.style.background = isError ? "#fff7f7" : "";
    el.style.borderColor = isError ? "#f0c9c9" : "";
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\r/g, " ")
      .replace(/\t/g, " ")
      .replace(/[^\S\n]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  async function extractTextFromPdf(file) {
    const arrayBuffer = await file.arrayBuffer();
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.5.136/pdf.worker.min.js";

    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(" ");
      fullText += pageText + "\n";
    }

    return normalizeText(fullText);
  }

  function splitIntoSentences(text) {
    return normalizeText(text)
      .split(/(?<=[.!?])\s+|\n+/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function extractCandidateWords(text, maxWords) {
    const rawWords = String(text || "")
      .toUpperCase()
      .match(/[A-Z][A-Z]+/g) || [];

    const freq = new Map();

    for (const word of rawWords) {
      if (word.length < 4 || word.length > 12) continue;
      if (STOP_WORDS.has(word)) continue;
      if (!/[AEIOU]/.test(word)) continue;

      freq.set(word, (freq.get(word) || 0) + 1);
    }

    const sorted = [...freq.entries()]
      .sort((a, b) => {
        const freqDiff = b[1] - a[1];
        if (freqDiff !== 0) return freqDiff;
        return b[0].length - a[0].length;
      })
      .map(([word]) => word);

    const uniqueBalanced = sorted
      .sort((a, b) => b.length - a.length)
      .slice(0, maxWords * 2);

    // favor a mix of long/medium words
    const finalWords = [];
    const used = new Set();

    for (const word of uniqueBalanced) {
      if (used.has(word)) continue;
      finalWords.push(word);
      used.add(word);
      if (finalWords.length >= maxWords) break;
    }

    return finalWords;
  }

  function buildClueForWord(word, sentences) {
    const sentence = sentences.find(s =>
      s.toUpperCase().includes(word)
    );

    if (!sentence) {
      return `Keyword from the PDF document (${word.length} letters)`;
    }

    const masked = sentence.replace(new RegExp(word, "ig"), "_".repeat(word.length));
    return masked;
  }

  function createEmptyGrid(size) {
    return Array.from({ length: size }, () =>
      Array.from({ length: size }, () => null)
    );
  }

  function canPlaceWord(grid, word, row, col, dir) {
    const size = grid.length;

    for (let i = 0; i < word.length; i++) {
      const r = dir === "across" ? row : row + i;
      const c = dir === "across" ? col + i : col;

      if (r < 0 || c < 0 || r >= size || c >= size) return false;

      const existing = grid[r][c];
      if (existing !== null && existing !== word[i]) return false;
    }

    return true;
  }

  function placeWord(grid, word, row, col, dir, placements) {
    for (let i = 0; i < word.length; i++) {
      const r = dir === "across" ? row : row + i;
      const c = dir === "across" ? col + i : col;
      grid[r][c] = word[i];
    }

    placements.push({
      word,
      row,
      col,
      dir
    });
  }

  function findPlacementForWord(grid, word, placements) {
    if (placements.length === 0) {
      const mid = Math.floor(grid.length / 2);
      const startCol = Math.max(0, Math.floor((grid.length - word.length) / 2));
      return { row: mid, col: startCol, dir: "across" };
    }

    // Try to cross with existing words first
    for (const placed of placements) {
      for (let i = 0; i < placed.word.length; i++) {
        for (let j = 0; j < word.length; j++) {
          if (placed.word[i] !== word[j]) continue;

          let row, col, dir;
          if (placed.dir === "across") {
            dir = "down";
            row = placed.row - j;
            col = placed.col + i;
          } else {
            dir = "across";
            row = placed.row + i;
            col = placed.col - j;
          }

          if (canPlaceWord(grid, word, row, col, dir)) {
            return { row, col, dir };
          }
        }
      }
    }

    // fallback scan
    for (let row = 0; row < grid.length; row++) {
      for (let col = 0; col < grid.length; col++) {
        for (const dir of ["across", "down"]) {
          if (canPlaceWord(grid, word, row, col, dir)) {
            return { row, col, dir };
          }
        }
      }
    }

    return null;
  }

  function numberPlacements(grid, placements) {
    const numberMap = new Map();
    let clueNumber = 1;

    const starts = placements
      .map(p => ({
        ...p,
        key: `${p.row},${p.col}`
      }))
      .sort((a, b) => {
        if (a.row !== b.row) return a.row - b.row;
        return a.col - b.col;
      });

    for (const p of starts) {
      if (!numberMap.has(p.key)) {
        numberMap.set(p.key, clueNumber++);
      }
      p.number = numberMap.get(p.key);
    }

    return starts;
  }

  function generateCrossword(words, sentences, size) {
    const grid = createEmptyGrid(size);
    const placements = [];

    const sortedWords = [...words].sort((a, b) => b.length - a.length);

    for (const word of sortedWords) {
      const found = findPlacementForWord(grid, word, placements);
      if (found) {
        placeWord(grid, word, found.row, found.col, found.dir, placements);
      }
    }

    const numbered = numberPlacements(grid, placements);

    const across = numbered
      .filter(p => p.dir === "across")
      .map(p => ({
        number: p.number,
        answer: p.word,
        clue: buildClueForWord(p.word, sentences),
        row: p.row,
        col: p.col
      }));

    const down = numbered
      .filter(p => p.dir === "down")
      .map(p => ({
        number: p.number,
        answer: p.word,
        clue: buildClueForWord(p.word, sentences),
        row: p.row,
        col: p.col
      }));

    return {
      size,
      grid,
      placements: numbered,
      across,
      down
    };
  }

  function renderWordBank(words) {
    els.wordBank.innerHTML = words.length
      ? words.map(w => `<span class="chip">${escapeHtml(w)}</span>`).join("")
      : '<span class="muted">No candidate words yet.</span>';
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderGrid(puzzle) {
    const { grid, size, placements } = puzzle;
    const startNumbers = new Map();

    for (const p of placements) {
      startNumbers.set(`${p.row},${p.col}`, p.number);
    }

    els.crosswordGrid.style.gridTemplateColumns = `repeat(${size}, var(--cell))`;
    els.crosswordGrid.innerHTML = "";

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const val = grid[r][c];
        const cell = document.createElement("div");
        cell.className = `cell ${val === null ? "black" : ""}`;

        if (val !== null) {
          const number = startNumbers.get(`${r},${c}`);
          if (number) {
            const n = document.createElement("div");
            n.className = "cell-number";
            n.textContent = number;
            cell.appendChild(n);
          }
          cell.appendChild(document.createTextNode(val));
        }

        els.crosswordGrid.appendChild(cell);
      }
    }
  }

  function renderClues(puzzle) {
    els.acrossClues.innerHTML = puzzle.across
      .map(clue => `<li><strong>${clue.number}.</strong> ${escapeHtml(clue.clue)} <span class="muted">(${clue.answer.length})</span></li>`)
      .join("");

    els.downClues.innerHTML = puzzle.down
      .map(clue => `<li><strong>${clue.number}.</strong> ${escapeHtml(clue.clue)} <span class="muted">(${clue.answer.length})</span></li>`)
      .join("");
  }

  function downloadPuzzleSummary() {
    if (!state.puzzle) {
      setStatus(els.generateStatus, "Generate a puzzle first.", true);
      return;
    }

    const lines = [];
    lines.push("PDF TO CROSSWORD PUZZLE");
    lines.push("");
    lines.push("ACROSS");
    for (const clue of state.puzzle.across) {
      lines.push(`${clue.number}. ${clue.clue} [${clue.answer.length}]`);
    }
    lines.push("");
    lines.push("DOWN");
    for (const clue of state.puzzle.down) {
      lines.push(`${clue.number}. ${clue.clue} [${clue.answer.length}]`);
    }
    lines.push("");
    lines.push("ANSWERS");
    for (const p of state.puzzle.placements) {
      lines.push(`${p.number}. ${p.word} (${p.dir})`);
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "crossword-puzzle.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

 async function handleExtract() {
  const file = els.pdfFile.files?.[0];
  if (!file) {
    setStatus(els.extractStatus, "Choose a PDF first.", true);
    return;
  }

  if (typeof pdfjsLib === "undefined") {
    setStatus(els.extractStatus, "pdf.js failed to load. Check internet/CDN access or script path.", true);
    return;
  }

  try {
    setStatus(els.extractStatus, `Reading PDF: ${file.name} ...`);
    const text = await extractTextFromPdf(file);
    state.extractedText = text;
    state.sentences = splitIntoSentences(text);
    els.sourceText.value = text;
    setStatus(
      els.extractStatus,
      `PDF extracted successfully.\nCharacters: ${text.length}\nSentences: ${state.sentences.length}`
    );
  } catch (err) {
    setStatus(els.extractStatus, `Failed to extract PDF text: ${err.message || err}`, true);
  }
}
async function loadPdfFromServer() {

  try {

    const url = "/Adventist_Testimony.pdf";

    setStatus(els.extractStatus, "Loading PDF from server...");

    const loadingTask = pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;

    let text = "";

    for (let page = 1; page <= pdf.numPages; page++) {

      const p = await pdf.getPage(page);
      const content = await p.getTextContent();

      const pageText = content.items.map(i => i.str).join(" ");

      text += pageText + "\n";

    }

    state.extractedText = text;
    state.sentences = splitIntoSentences(text);
    els.sourceText.value = text;

    setStatus(
      els.extractStatus,
      "PDF loaded from server successfully."
    );

  } catch (err) {

    setStatus(
      els.extractStatus,
      "Failed to load server PDF: " + err,
      true
    );

  }

}

  function handleAnalyze() {
    const text = normalizeText(els.sourceText.value);
    if (!text) {
      setStatus(els.analysisStatus, "Paste or extract some text first.", true);
      return;
    }

    const maxWords = Math.max(5, Math.min(30, Number(els.wordCount.value || 12)));
    state.sentences = splitIntoSentences(text);
    state.candidateWords = extractCandidateWords(text, maxWords);
    renderWordBank(state.candidateWords);

    setStatus(
      els.analysisStatus,
      `Analyzed text.\nCandidate words found: ${state.candidateWords.length}\nTop words: ${state.candidateWords.join(", ")}`
    );
  }

  function handleGenerate() {
    const text = normalizeText(els.sourceText.value);
    if (!text) {
      setStatus(els.generateStatus, "Extract or paste text first.", true);
      return;
    }

    if (!state.candidateWords.length) {
      state.sentences = splitIntoSentences(text);
      state.candidateWords = extractCandidateWords(
        text,
        Math.max(5, Math.min(30, Number(els.wordCount.value || 12)))
      );
      renderWordBank(state.candidateWords);
    }

    if (!state.candidateWords.length) {
      setStatus(els.generateStatus, "Could not find enough good words for a puzzle.", true);
      return;
    }

    const size = Math.max(10, Math.min(30, Number(els.gridSize.value || 15)));
    const puzzle = generateCrossword(state.candidateWords, state.sentences, size);
    state.puzzle = puzzle;

    renderGrid(puzzle);
    renderClues(puzzle);

    setStatus(
      els.generateStatus,
      `Crossword generated.\nPlaced words: ${puzzle.placements.length}\nAcross: ${puzzle.across.length}\nDown: ${puzzle.down.length}`
    );
  }

  function bindEvents() {
    els.extractBtn.addEventListener("click", handleExtract);
    els.analyzeBtn.addEventListener("click", handleAnalyze);
    els.generateBtn.addEventListener("click", handleGenerate);
    els.downloadBtn.addEventListener("click", downloadPuzzleSummary);
  }

  bindEvents();
})();