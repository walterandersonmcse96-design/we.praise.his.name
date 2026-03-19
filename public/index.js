function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
if (typeof pdfjsLib !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const state = {
  extractedText: "",
  sentences: [],
  candidateWords: [],
  placedWords: [],
  puzzle: null
};

const STOP_WORDS = new Set([
  "THE","AND","FOR","ARE","WITH","THIS","THAT","FROM","YOUR","HAVE","WILL","THEY","INTO","THERE",
  "ABOUT","WHICH","WHEN","WHERE","WHAT","THOSE","THESE","THAN","THEN","WERE","BEING","BEEN","HAD",
  "HAS","HAVE","YOU","HIS","HER","ITS","OUR","OUT","NOT","CAN","ALL","ANY","MAY","USE","ONE","TWO",
  "THREE","FOUR","FIVE","FIRST","SECOND","NEW","MORE","MOST","OVER","UNDER","VERY","MUCH","SOME",
  "EACH","OTHER","ALSO","ONLY","SUCH","LIKE","JUST","TEXT","PAGE","PAGES","INFORMATION","DOCUMENT",
  "VERSION","LATEST","STABLE","INSTALL","PLEASE","SELECT","DOMAIN","CUSTOM","SITE","USERNAME","PASSWORD",
  "GOD","LORD","JESUS","CHRIST","WORD","LIGHT"
]);

function $(id) {
  return document.getElementById(id);
}

function setStatus(id, text, isError = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "#a12626" : "";
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r/g, " ")
    .replace(/\t/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function splitIntoSentences(text) {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean);
}

async function loadPdfFromUrl(url) {
  try {
    if (typeof pdfjsLib === "undefined") {
      setStatus("extractStatus", "Failed to load PDF library (pdfjsLib missing).", true);
      return;
    }

    setStatus("extractStatus", "Loading PDF...");
    const pdf = await pdfjsLib.getDocument(url).promise;
    let fullText = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(" ");
      fullText += pageText + "\n";
    }

    state.extractedText = normalizeText(fullText);
    state.sentences = splitIntoSentences(state.extractedText);
    $("sourceText").value = state.extractedText;

    setStatus("extractStatus", `PDF text extracted successfully. Pages: ${pdf.numPages}`);
  } catch (err) {
    setStatus("extractStatus", "Failed to load PDF: " + err.message, true);
  }
}

function cleanClueText(text) {
  let out = String(text || "").replace(/\s+/g, " ").trim();
  if (out.length > 160) out = out.slice(0, 157) + "...";
  return out;
}

function buildClue(word) {
  const sentence = state.sentences.find(s => s.toUpperCase().includes(word));
  if (!sentence) return `Document word (${word.length} letters)`;

  // Use word-boundary safe replacement and ensure the masked word is
  // surrounded by spaces so it's easy to spot in the hint sentence.
  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  const pattern = new RegExp("\\b" + escapeRegExp(word) + "\\b", "ig");
  const replacement = " " + "_".repeat(word.length) + " ";
  const masked = sentence.replace(pattern, replacement);
  return cleanClueText(masked);
}

function extractCandidateWords(text, maxWords) {
  const rawWords = String(text || "").toUpperCase().match(/[A-Z][A-Z]+/g) || [];
  const freq = new Map();

  for (const word of rawWords) {
    if (word.length < 4 || word.length > 10) continue;
    if (STOP_WORDS.has(word)) continue;
    if (!/[AEIOU]/.test(word)) continue;
    if (/^(TION|MENT|NESS|ALLY)$/.test(word)) continue;
    freq.set(word, (freq.get(word) || 0) + 1);
  }

  const sorted = [...freq.entries()]
    .sort((a, b) => {
      const freqDiff = b[1] - a[1];
      if (freqDiff !== 0) return freqDiff;

      const aMidScore = Math.abs(7 - a[0].length);
      const bMidScore = Math.abs(7 - b[0].length);
      if (aMidScore !== bMidScore) return aMidScore - bMidScore;

      return a[0].localeCompare(b[0]);
    })
    .map(([word]) => word);

  return sorted.slice(0, Math.max(maxWords * 3, 40));
}

function renderWordBank(words) {
  const bank = $("wordBank");
  bank.innerHTML = "";
  for (const word of words) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = word;
    bank.appendChild(chip);
  }
}

function createEmptyGrid(size) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

function inBounds(grid, r, c) {
  return r >= 0 && c >= 0 && r < grid.length && c < grid.length;
}

function canPlaceWord(grid, word, row, col, dir) {
  const dr = dir === "down" ? 1 : 0;
  const dc = dir === "across" ? 1 : 0;

  for (let i = 0; i < word.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;

    if (!inBounds(grid, r, c)) return false;

    const cell = grid[r][c];
    if (cell !== null && cell !== word[i]) return false;
  }

  return true;
}

function placeWord(grid, placements, word, row, col, dir) {
  const dr = dir === "down" ? 1 : 0;
  const dc = dir === "across" ? 1 : 0;

  for (let i = 0; i < word.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    grid[r][c] = word[i];
  }

  placements.push({ word, row, col, direction: dir });
}

function tryFindCrossPlacement(grid, placements, word) {
  for (const placed of placements) {
    for (let i = 0; i < placed.word.length; i++) {
      for (let j = 0; j < word.length; j++) {
        if (placed.word[i] !== word[j]) continue;

        let row, col, dir;
        if (placed.direction === "across") {
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
  return null;
}

function tryFindFallbackPlacement(grid, word) {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid.length; c++) {
      for (const dir of ["across", "down"]) {
        if (canPlaceWord(grid, word, r, c, dir)) {
          return { row: r, col: c, dir };
        }
      }
    }
  }
  return null;
}

function trimGrid(grid, placements) {
  let minR = grid.length, minC = grid.length, maxR = 0, maxC = 0;

  for (const p of placements) {
    const dr = p.direction === "down" ? 1 : 0;
    const dc = p.direction === "across" ? 1 : 0;
    for (let i = 0; i < p.word.length; i++) {
      const r = p.row + dr * i;
      const c = p.col + dc * i;
      minR = Math.min(minR, r);
      minC = Math.min(minC, c);
      maxR = Math.max(maxR, r);
      maxC = Math.max(maxC, c);
    }
  }

  const newGrid = [];
  for (let r = minR; r <= maxR; r++) {
    const row = [];
    for (let c = minC; c <= maxC; c++) {
      row.push(grid[r][c]);
    }
    newGrid.push(row);
  }

  const newPlacements = placements.map(p => ({
    ...p,
    row: p.row - minR,
    col: p.col - minC
  }));

  return { grid: newGrid, placements: newPlacements };
}

function numberPlacements(placements) {
  const starts = new Map();
  let n = 1;

  const sorted = [...placements].sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });

  for (const p of sorted) {
    const key = `${p.row},${p.col}`;
    if (!starts.has(key)) starts.set(key, n++);
    p.number = starts.get(key);
  }

  return sorted;
}

function generateCrossword(words, requestedCount, size) {
  const grid = createEmptyGrid(size);
  const placements = [];

  const sortedWords = [...words]
    .filter(w => w.length >= 4 && w.length <= 10)
    .sort((a, b) => {
      const aScore = Math.abs(7 - a.length);
      const bScore = Math.abs(7 - b.length);
      if (aScore !== bScore) return aScore - bScore;
      return b.length - a.length;
    });

  if (!sortedWords.length) {
    return { grid, placements: [], across: [], down: [] };
  }

  const first = sortedWords[0];
  const mid = Math.floor(size / 2);
  const startCol = Math.max(0, Math.floor((size - first.length) / 2));
  placeWord(grid, placements, first, mid, startCol, "across");

  for (let i = 1; i < sortedWords.length; i++) {
    if (placements.length >= requestedCount) break;

    const word = sortedWords[i];
    if (placements.some(p => p.word === word)) continue;

    let found = tryFindCrossPlacement(grid, placements, word);
    if (!found) found = tryFindFallbackPlacement(grid, word);

    if (found) {
      placeWord(grid, placements, word, found.row, found.col, found.dir);
    }
  }

  const trimmed = trimGrid(grid, placements);
  const numbered = numberPlacements(trimmed.placements);

  const across = numbered
    .filter(p => p.direction === "across")
    .map(p => ({
      number: p.number,
      clue: buildClue(p.word),
      answer: p.word,
      row: p.row,
      col: p.col,
      direction: "across"
    }));

  const down = numbered
    .filter(p => p.direction === "down")
    .map(p => ({
      number: p.number,
      clue: buildClue(p.word),
      answer: p.word,
      row: p.row,
      col: p.col,
      direction: "down"
    }));

  return {
    grid: trimmed.grid,
    placements: numbered,
    across,
    down
  };
}

function getCellSize(size) {
  if (size >= 75) return 16;
  if (size >= 50) return 22;
  if (size >= 25) return 30;
  return 38;
}

function renderGrid(puzzle) {
  const container = $("crosswordGrid");
  container.innerHTML = "";

  const rows = puzzle.grid.length;
  const cols = rows ? puzzle.grid[0].length : 0;
  const cellSize = getCellSize(Math.max(rows, cols));
  container.style.gridTemplateColumns = `repeat(${cols}, ${cellSize}px)`;

  const startNumbers = new Map();
  for (const p of puzzle.placements) {
    startNumbers.set(`${p.row},${p.col}`, p.number);
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = puzzle.grid[r][c];
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.style.width = `${cellSize}px`;
      cell.style.height = `${cellSize}px`;
      cell.style.fontSize = cellSize <= 18 ? "10px" : cellSize <= 22 ? "12px" : "18px";

      if (val === null) {
        cell.classList.add("black");
      } else {
        const num = startNumbers.get(`${r},${c}`);
        if (num) {
          const n = document.createElement("div");
          n.className = "cell-number";
          n.textContent = num;
          cell.appendChild(n);
        }
        cell.appendChild(document.createTextNode(val));
      }

      container.appendChild(cell);
    }
  }
}

function renderClues(puzzle) {
  $("acrossClues").innerHTML = puzzle.across
    .map(c => `<li><strong>${c.number}.</strong> ${escapeHtml(c.clue)} <span class="muted">(${c.answer.length})</span></li>`)
    .join("");

  $("downClues").innerHTML = puzzle.down
    .map(c => `<li><strong>${c.number}.</strong> ${escapeHtml(c.clue)} <span class="muted">(${c.answer.length})</span></li>`)
    .join("");
}

function exportCrosswordJson(puzzle) {
  const allWords = [
    ...puzzle.across.map(w => ({
      answer: w.answer,
      clue: w.clue,
      row: w.row,
      col: w.col,
      direction: "across",
      number: w.number
    })),
    ...puzzle.down.map(w => ({
      answer: w.answer,
      clue: w.clue,
      row: w.row,
      col: w.col,
      direction: "down",
      number: w.number
    }))
  ].sort((a, b) => a.number - b.number);

  return {
    title: "Adventist Crossword",
    gridSize: parseInt($("gridSize").value, 10) || 25,
    words: allWords,
    meta: {
      generatedAt: new Date().toISOString(),
      placedCount: allWords.length,
      skippedCount: Math.max(0, state.candidateWords.length - allWords.length),
      sourceTextLength: state.extractedText.length
    }
  };
}

document.addEventListener("DOMContentLoaded", () => {
  $("loadServerPdf")?.addEventListener("click", () => {
    loadPdfFromUrl("/Adventist_Testimony.pdf");
  });

  $("extractBtn")?.addEventListener("click", async () => {
    const fileInput = $("pdfFile");
    if (!fileInput || !fileInput.files.length) {
      alert("Please choose a PDF");
      return;
    }
    const file = fileInput.files[0];
    const url = URL.createObjectURL(file);
    await loadPdfFromUrl(url);
  });

  $("analyzeBtn")?.addEventListener("click", () => {
    const text = $("sourceText").value;
    if (!text) {
      alert("No text to analyze");
      return;
    }

    const maxWords = Math.max(12, Math.min(80, parseInt($("wordCount").value, 10) || 25));
    state.sentences = splitIntoSentences(text);
    state.candidateWords = extractCandidateWords(text, maxWords);
    renderWordBank(state.candidateWords);

    $("analysisStatus").textContent =
      `${state.candidateWords.length} candidate words prepared.`;
  });

  $("generateBtn")?.addEventListener("click", () => {
    const text = $("sourceText").value;
    if (!text) {
      alert("Load or extract a PDF first");
      return;
    }

    const requestedCount = Math.max(12, Math.min(50, parseInt($("wordCount").value, 10) || 25));
    const size = Math.max(15, Math.min(75, parseInt($("gridSize").value, 10) || 25));

    if (!state.candidateWords.length) {
      state.sentences = splitIntoSentences(text);
      state.candidateWords = extractCandidateWords(text, requestedCount * 3);
      renderWordBank(state.candidateWords);
    }

    state.puzzle = generateCrossword(state.candidateWords, requestedCount, size);
    state.placedWords = state.puzzle.placements.map(p => p.word);

    renderGrid(state.puzzle);
    renderClues(state.puzzle);

    $("generateStatus").textContent =
      `Crossword generated. Placed ${state.puzzle.placements.length} words with hints.`;
  });

  $("downloadBtn")?.addEventListener("click", () => {
    if (!state.puzzle) {
      alert("Generate a crossword first");
      return;
    }

    const payload = exportCrosswordJson(state.puzzle);

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "crossword.json";
    a.click();
  });
});
