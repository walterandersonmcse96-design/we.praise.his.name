if (typeof pdfjsLib !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const state = {
  extractedText: "",
  sentences: [],
  candidateWords: [],
  puzzle: null
};

const STOP_WORDS = new Set([
  "THE","AND","FOR","ARE","WITH","THIS","THAT","FROM","YOUR","HAVE","WILL","THEY","INTO","THERE",
  "ABOUT","WHICH","WHEN","WHERE","WHAT","THOSE","THESE","THAN","THEN","WERE","BEING","BEEN","HAD",
  "HAS","HAVE","YOU","HIS","HER","ITS","OUR","OUT","NOT","CAN","ALL","ANY","MAY","USE","ONE","TWO",
  "THREE","FOUR","FIVE","FIRST","SECOND","NEW","MORE","MOST","OVER","UNDER","VERY","MUCH","SOME",
  "EACH","OTHER","ALSO","ONLY","SUCH","LIKE","JUST","TEXT","PAGE","PAGES","INFORMATION","DOCUMENT"
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

    setStatus("extractStatus", "PDF text extracted successfully.");
  } catch (err) {
    setStatus("extractStatus", "Failed to load PDF: " + err.message, true);
  }
}

function extractCandidateWords(text, maxWords) {
  const rawWords = String(text || "").toUpperCase().match(/[A-Z][A-Z]+/g) || [];
  const freq = new Map();

  for (const word of rawWords) {
    if (word.length < 4 || word.length > 12) continue;
    if (STOP_WORDS.has(word)) continue;
    if (!/[AEIOU]/.test(word)) continue;
    freq.set(word, (freq.get(word) || 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => {
      const fd = b[1] - a[1];
      if (fd !== 0) return fd;
      return b[0].length - a[0].length;
    })
    .map(([word]) => word)
    .slice(0, maxWords);
}

function buildClue(word) {
  const sentence = state.sentences.find(s => s.toUpperCase().includes(word));
  if (!sentence) return `Word from the document (${word.length})`;
  return sentence.replace(new RegExp(word, "ig"), "_".repeat(word.length));
}

function createEmptyGrid(size) {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null)
  );
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

    // avoid touching side-by-side unless crossing
    if (dir === "across") {
      const up = r - 1;
      const down = r + 1;
      if (cell === null) {
        if (inBounds(grid, up, c) && grid[up][c] !== null) return false;
        if (inBounds(grid, down, c) && grid[down][c] !== null) return false;
      }
    } else {
      const left = c - 1;
      const right = c + 1;
      if (cell === null) {
        if (inBounds(grid, r, left) && grid[r][left] !== null) return false;
        if (inBounds(grid, r, right) && grid[r][right] !== null) return false;
      }
    }
  }

  // cell before start and after end must be empty
  const beforeR = row - dr;
  const beforeC = col - dc;
  const afterR = row + dr * word.length;
  const afterC = col + dc * word.length;

  if (inBounds(grid, beforeR, beforeC) && grid[beforeR][beforeC] !== null) return false;
  if (inBounds(grid, afterR, afterC) && grid[afterR][afterC] !== null) return false;

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

  placements.push({ word, row, col, dir });
}

function tryFindCrossPlacement(grid, placements, word) {
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

function numberPlacements(placements) {
  const starts = new Map();
  let n = 1;

  const sorted = [...placements].sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });

  for (const p of sorted) {
    const key = `${p.row},${p.col}`;
    if (!starts.has(key)) {
      starts.set(key, n++);
    }
    p.number = starts.get(key);
  }

  return sorted;
}

function trimGrid(grid, placements) {
  let minR = grid.length, minC = grid.length, maxR = 0, maxC = 0;

  for (const p of placements) {
    const dr = p.dir === "down" ? 1 : 0;
    const dc = p.dir === "across" ? 1 : 0;
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

function generateCrossword(words, size) {
  const grid = createEmptyGrid(size);
  const placements = [];
  const sortedWords = [...words].sort((a, b) => b.length - a.length);

  if (!sortedWords.length) {
    return { grid, placements: [], across: [], down: [] };
  }

  // place first word centered
  const first = sortedWords[0];
  const mid = Math.floor(size / 2);
  const startCol = Math.max(0, Math.floor((size - first.length) / 2));
  placeWord(grid, placements, first, mid, startCol, "across");

  for (let i = 1; i < sortedWords.length; i++) {
    const word = sortedWords[i];
    let found = tryFindCrossPlacement(grid, placements, word);
    if (!found) {
      found = tryFindFallbackPlacement(grid, word);
    }
    if (found) {
      placeWord(grid, placements, word, found.row, found.col, found.dir);
    }
  }

  const trimmed = trimGrid(grid, placements);
  const numbered = numberPlacements(trimmed.placements);

  const across = numbered
    .filter(p => p.dir === "across")
    .map(p => ({
      number: p.number,
      clue: buildClue(p.word),
      answer: p.word
    }));

  const down = numbered
    .filter(p => p.dir === "down")
    .map(p => ({
      number: p.number,
      clue: buildClue(p.word),
      answer: p.word
    }));

  return {
    grid: trimmed.grid,
    placements: numbered,
    across,
    down
  };
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

function renderGrid(puzzle) {
  const container = $("crosswordGrid");
  container.innerHTML = "";

  const rows = puzzle.grid.length;
  const cols = rows ? puzzle.grid[0].length : 0;
  container.style.gridTemplateColumns = `repeat(${cols}, 38px)`;

  const startNumbers = new Map();
  for (const p of puzzle.placements) {
    startNumbers.set(`${p.row},${p.col}`, p.number);
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = puzzle.grid[r][c];
      const cell = document.createElement("div");
      cell.className = "cell";
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
  const acrossEl = $("acrossClues");
  const downEl = $("downClues");

  acrossEl.innerHTML = puzzle.across
    .map(c => `<li><strong>${c.number}.</strong> ${escapeHtml(c.clue)} <span class="muted">(${c.answer.length})</span></li>`)
    .join("");

  downEl.innerHTML = puzzle.down
    .map(c => `<li><strong>${c.number}.</strong> ${escapeHtml(c.clue)} <span class="muted">(${c.answer.length})</span></li>`)
    .join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

    const maxWords = Math.max(5, Math.min(30, parseInt($("wordCount").value, 10) || 12));
    state.sentences = splitIntoSentences(text);
    state.candidateWords = extractCandidateWords(text, maxWords);
    renderWordBank(state.candidateWords);

    $("analysisStatus").textContent =
      `${state.candidateWords.length} candidate words selected.`;
  });

  $("generateBtn")?.addEventListener("click", () => {
    const text = $("sourceText").value;
    if (!text) {
      alert("Load or extract a PDF first");
      return;
    }

    if (!state.candidateWords.length) {
      const maxWords = Math.max(5, Math.min(30, parseInt($("wordCount").value, 10) || 12));
      state.sentences = splitIntoSentences(text);
      state.candidateWords = extractCandidateWords(text, maxWords);
      renderWordBank(state.candidateWords);
    }

    const size = Math.max(10, Math.min(30, parseInt($("gridSize").value, 10) || 15));
    state.puzzle = generateCrossword(state.candidateWords, size);

    renderGrid(state.puzzle);
    renderClues(state.puzzle);

    $("generateStatus").textContent =
      `Crossword generated. Across: ${state.puzzle.across.length}, Down: ${state.puzzle.down.length}`;
  });

  $("downloadBtn")?.addEventListener("click", () => {
    if (!state.puzzle) {
      alert("Generate a crossword first");
      return;
    }

    const payload = {
      across: state.puzzle.across,
      down: state.puzzle.down,
      words: state.candidateWords
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "crossword.json";
    a.click();
  });
});
