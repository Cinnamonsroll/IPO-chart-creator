"use strict";

const WIDTH = 1500;
const HEIGHT = 400;
const SCALE = 2;
const BOX_WIDTH = 420;
const BOX_HEIGHT = 300;
const GAP = 90;
const PADDING = 24;
const LINE_HEIGHT = 1.25;
const FONT_SIZE_MAX = 32;
const FONT_SIZE_MIN = 6;
const FONT = "Arial, Helvetica, sans-serif";

const canvas = document.createElement("canvas");
canvas.width = WIDTH * SCALE;
canvas.height = HEIGHT * SCALE;
const ctx = canvas.getContext("2d");

const img = document.getElementById("img");
const statusEl = document.getElementById("status");
const headsInput = document.getElementById("heads");
const textInputs = [
  document.getElementById("inp"),
  document.getElementById("proc"),
  document.getElementById("out"),
];

const measure = (text) => ctx.measureText(text).width;

const setFont = (size, weight = "normal") => {
  ctx.font = `${weight} ${size}px ${FONT}`;
};

function breakLongWord(word, maxWidth) {
  const parts = [];
  let part = "";
  for (const char of word) {
    const next = part + char;
    if (part && measure(next) > maxWidth) {
      parts.push(part);
      part = char;
    } else {
      part = next;
    }
  }
  if (part) parts.push(part);
  return parts;
}

function wrapText(text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const pieces =
        measure(word) > maxWidth ? breakLongWord(word, maxWidth) : [word];
      for (const piece of pieces) {
        const candidate = line ? `${line} ${piece}` : piece;
        if (line && measure(candidate) > maxWidth) {
          lines.push(line);
          line = piece;
        } else {
          line = candidate;
        }
      }
    }
    lines.push(line);
  }
  return lines;
}

function fitText(text, maxWidth, maxHeight) {
  let size = FONT_SIZE_MIN;
  let lines = [];
  for (size = FONT_SIZE_MAX; size >= FONT_SIZE_MIN; size--) {
    setFont(size);
    lines = wrapText(text, maxWidth);
    if (lines.length * size * LINE_HEIGHT <= maxHeight) break;
  }
  return { size, lines };
}

function drawArrow(fromX, toX, y) {
  const head = 16;
  ctx.beginPath();
  ctx.moveTo(fromX, y);
  ctx.lineTo(toX - head + 2, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(toX, y);
  ctx.lineTo(toX - head, y - head * 0.6);
  ctx.lineTo(toX - head, y + head * 0.6);
  ctx.closePath();
  ctx.fill();
}

function drawBox(item, x, y, showHeading) {
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, BOX_WIDTH, BOX_HEIGHT);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  let textTop = y + PADDING;
  let textHeight = BOX_HEIGHT - PADDING * 2;

  if (showHeading) {
    setFont(30, "bold");
    ctx.fillText(item.title, x + BOX_WIDTH / 2, y + PADDING + 26);
    const lineY = y + PADDING + 40;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + PADDING, lineY);
    ctx.lineTo(x + BOX_WIDTH - PADDING, lineY);
    ctx.stroke();
    textTop = lineY + 12;
    textHeight = y + BOX_HEIGHT - PADDING - textTop;
  }

  const maxWidth = BOX_WIDTH - PADDING * 2;
  const { size, lines } = fitText(item.text, maxWidth, textHeight);
  setFont(size);
  const lineHeight = size * LINE_HEIGHT;
  const blockHeight = lines.length * lineHeight;
  const startY = textTop + (textHeight - blockHeight) / 2;

  lines.forEach((line, index) => {
    ctx.fillText(
      line,
      x + BOX_WIDTH / 2,
      startY + index * lineHeight + size * 0.95,
    );
  });
}

function draw() {
  const showHeadings = headsInput.checked;
  const items = textInputs.map((input, index) => ({
    title: ["Input", "Process", "Output"][index],
    text: input.value,
  }));

  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.strokeStyle = "#000000";
  ctx.fillStyle = "#000000";
  ctx.lineJoin = "miter";

  const totalWidth = BOX_WIDTH * 3 + GAP * 2;
  const x0 = (WIDTH - totalWidth) / 2;
  const y0 = (HEIGHT - BOX_HEIGHT) / 2;

  items.forEach((item, index) => {
    drawBox(item, x0 + index * (BOX_WIDTH + GAP), y0, showHeadings);
  });

  ctx.lineWidth = 3;
  for (let i = 0; i < 2; i++) {
    const arrowStart = x0 + i * (BOX_WIDTH + GAP) + BOX_WIDTH;
    drawArrow(arrowStart + 4, arrowStart + GAP - 4, y0 + BOX_HEIGHT / 2);
  }

  img.src = canvas.toDataURL("image/png");
}

let frameRequest = null;
function scheduleDraw() {
  if (frameRequest !== null) return;
  frameRequest = requestAnimationFrame(() => {
    frameRequest = null;
    draw();
  });
}

function setStatus(message, ok) {
  statusEl.textContent = message;
  statusEl.classList.toggle("ok", Boolean(ok));
}

async function copyImage() {
  try {
    const blobPromise = new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        blob ? resolve(blob) : reject(new Error("Canvas export failed"));
      }, "image/png");
    });
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blobPromise }),
    ]);
    setStatus("Copied. Paste it where you need it.", true);
  } catch {
    setStatus(
      "Copying is blocked in this view. Right-click the chart (or long-press on a phone) and choose Copy image.",
      false,
    );
  }
}

textInputs.forEach((input) => input.addEventListener("input", scheduleDraw));
headsInput.addEventListener("change", draw);
document.getElementById("copy").addEventListener("click", copyImage);

draw();
document.fonts?.ready.then(draw);