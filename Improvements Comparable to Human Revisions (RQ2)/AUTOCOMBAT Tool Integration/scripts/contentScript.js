const DEBUG = true;
const log = (...args) => DEBUG && console.log("[AUTOCOMBAT]", ...args);

const BASE_API_URL = "http://localhost:5000/process";
const BTN_CLASS = "improve-btn";
const IMPROVED_BLOCK_CLASS = "improved-answer";

// ---------- utils ----------
const getText = el => (el && (el.innerText || el.textContent) || "").trim();
const escapeHtml = s => (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

// ---------- formatting (SO-like prose + code) ----------
function escapeInline(text) {
  const e = escapeHtml(text || "");
  return e
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function renderTextBlock(text) {
  const parts = (text || "").replace(/\r/g, "").trim().split(/\n{2,}/);
  return parts
    .map(p => `<p>${escapeInline(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function formatImprovedAnswer(md) {
  if (!md) return "";
  const out = [];
  const fenceRe = /```([a-z0-9_+.\-]*)\n([\s\S]*?)```/gi;
  let last = 0, m;

  while ((m = fenceRe.exec(md)) !== null) {
    const before = md.slice(last, m.index);
    if (before.trim()) out.push(renderTextBlock(before));

    const lang = (m[1] || "").toLowerCase();
    const code = m[2].replace(/\s+$/,"");
    out.push(
      `<pre class="s-code-block"><code${lang ? ` class="language-${lang}"` : ""}>${escapeHtml(code)}</code></pre>`
    );

    last = fenceRe.lastIndex;
  }

  const tail = md.slice(last);
  if (tail.trim()) out.push(renderTextBlock(tail));

  return out.join("");
}

// ---------- Stack Overflow extraction ----------
function getQuestionText() {
  const titleEl = document.querySelector(
    "h1 a, h1[itemprop='name'] a, h1.fs-headline1 a, h1 a.question-hyperlink"
  );
  const bodyEl  = document.querySelector(
    "#question .s-prose, .question .s-prose, .postcell .s-prose, .js-post-body"
  );
  return `${getText(titleEl)}\n\n${getText(bodyEl)}`.trim();
}

function getAnswerBodyText(answerElem) {
  return getText(answerElem.querySelector(".s-prose, .js-post-body"));
}

function getAnswerId(answerElem) {
  return (
    answerElem.getAttribute("data-answerid") ||
    answerElem.getAttribute("data-post-id") ||
    ((answerElem.id || "").match(/^answer-(\d+)/) || [])[1] ||
    (answerElem.querySelector("[data-post-id]")?.getAttribute("data-post-id")) ||
    null
  );
}

// Return the DOM node that holds comments for a given answer (if present)
function getCommentContainerForAnswer(answerElem) {
  const id = getAnswerId(answerElem);
  if (!id) return null;

  // Common containers:
  // 1) a sibling with id="comments-<id>"
  let sib = answerElem.nextElementSibling;
  if (sib && sib.id === `comments-${id}`) return sib;

  // 2) inline component variant
  const inline = answerElem.querySelector(`.js-post-comments-component[data-post-id="${id}"]`);
  if (inline) return inline;

  // 3) global container elsewhere in the page
  const globalById = document.querySelector(`#comments-${id}`);
  if (globalById) return globalById;

  // 4) fallback: any comments component referencing this post id
  const globalByAttr = document.querySelector(`.js-post-comments-component[data-post-id="${id}"]`);
  if (globalByAttr) return globalByAttr;

  return null;
}

// Comment nodes (if any are already in DOM)
function getCommentNodesForAnswer(answerElem) {
  const container = getCommentContainerForAnswer(answerElem) || answerElem;
  return Array.from(container.querySelectorAll(".comment-copy, .comment-text"));
}

// Is there at least one comment AVAILABLE for this answer?
// True if: we see comment nodes OR we see a "show more comments" link in the container.
function hasAtLeastOneCommentAvailable(answerElem) {
  const id = getAnswerId(answerElem);
  const container = getCommentContainerForAnswer(answerElem) || answerElem;

  const nodes = getCommentNodesForAnswer(answerElem);
  if (nodes.length > 0) {
    log(`Answer ${id || "(no-id)"}: found ${nodes.length} comment node(s).`);
    return true;
  }

  // Show-more links come in a few flavors; check all common ones:
  const showLink = container.querySelector(
    ".js-show-link, .comments-link, .js-show-link.comments-link, a[data-action='comments-expand']"
  );

  if (showLink) {
    log(`Answer ${id || "(no-id)"}: has a show-comments link (comments exist but not yet loaded).`);
    return true;
  }

  log(`Answer ${id || "(no-id)"}: no comments or show-link found.`);
  return false;
}

function getCommentsArray(answerElem) {
  return getCommentNodesForAnswer(answerElem)
    .map(n => getText(n))
    .filter(Boolean);
}

// ---------- UI ----------
function renderImprovedAnswer(answerElem, data) {
  const { improved_answer = "", concerns = [], used_question = false, change_log = [] } = data || {};
  const container = document.createElement("div");
  container.className = IMPROVED_BLOCK_CLASS;
  container.innerHTML = `
    <h3 class="improved-answer-title">Improved Answer:</h3>
    <div class="s-prose js-post-body">${formatImprovedAnswer(improved_answer)}</div>
    <div class="improved-answer-meta">
      <details>
        <summary>Concerns extracted (${concerns.length})</summary>
        <ul>${concerns.map(c=>`<li class="text-block">${escapeHtml(c)}</li>`).join("")}</ul>
      </details>
      <details>
        <summary>Change log (${change_log.length})</summary>
        <ul>${change_log.map(x=>`
          <li class="text-block">
            <b>Concern:</b> ${escapeHtml(x?.concern||"")}<br/>
            <b>Change:</b> ${escapeHtml(x?.change||"")}
          </li>`).join("")}
        </ul>
      </details>
      <p class="text-block"><i>Used question context:</i> ${used_question ? "yes" : "no"}</p>
    </div>
  `;
  const existing = answerElem.querySelector(`.${IMPROVED_BLOCK_CLASS}`);
  if (existing) existing.remove();
  (answerElem.querySelector(".s-prose, .js-post-body")?.parentElement || answerElem)
    .appendChild(container);
  if (window.hljs) {
    container.querySelectorAll("pre code").forEach((block) => {
        hljs.highlightElement(block);
    });
  }
}


// ---------- network ----------
async function fetchImprovedAnswer(question, answer, comments, answerElem) {
  try {
    const res = await fetch(BASE_API_URL, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ question, answer, comments })
    });
    const data = await res.json();
    log("API response", data);
    if (data && (data.improved_answer || data.concerns || data.change_log)) {
      renderImprovedAnswer(answerElem, data);
    }
  } catch (e) {
    console.error("[AUTOCOMBAT] API error:", e);
  }
}

// ---------- answers detection & button injection ----------
const ANSWER_SELECTORS = [
  "div.answer",
  "article.answer",
  "[data-post-type-id='2']",
  "div.js-answer",
  "article.js-post[data-post-type-id='2']",
];

function findAnswerElements() {
  const root = document.querySelector("#answers");
  const scope = root || document;
  const nodes = new Set();
  for (const sel of ANSWER_SELECTORS) {
    scope.querySelectorAll(sel).forEach(n => nodes.add(n));
  }
  return Array.from(nodes);
}

// Prefer post menu slot if present to match SO UI; otherwise append to the answer node.
function ensureButtonIfEligible(answerElem) {
  if (answerElem.querySelector(`.${BTN_CLASS}`)) return;
  if (!hasAtLeastOneCommentAvailable(answerElem)) return;

  const btn = document.createElement("button");
  btn.className = BTN_CLASS;
  btn.textContent = "AUTOCOMBAT";
  btn.addEventListener("click", () => {
    const q = getQuestionText();
    const a = getAnswerBodyText(answerElem);
    const comments = getCommentsArray(answerElem);
    fetchImprovedAnswer(q, a, comments, answerElem);
  });

  (answerElem.querySelector(".js-post-menu, .post-menu") || answerElem).appendChild(btn);

  const id = getAnswerId(answerElem) || "(no-id)";
  log(`Button injected on answer ${id}`);
}

function injectButtonsForAnswersWithComments() {
  const answers = findAnswerElements();
  log(`Found ${answers.length} candidate answers`);
  answers.forEach(ensureButtonIfEligible);
}

// ---------- observe SPA & dynamic loads ----------
let obs;
function startObserver() {
  if (obs) return;
  obs = new MutationObserver(muts => {
    if (muts.some(m => m.addedNodes && m.addedNodes.length)) {
      injectButtonsForAnswersWithComments();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // Re-run after users click "show more comments" links
  document.addEventListener("click", (e) => {
    const target = e.target.closest?.(".js-show-link, .comments-link, .js-show-link.comments-link, a[data-action='comments-expand']");
    if (!target) return;
    setTimeout(injectButtonsForAnswersWithComments, 250);
  });
}

// ---------- boot ----------
function boot() {
  try {
    injectButtonsForAnswersWithComments();
    setTimeout(injectButtonsForAnswersWithComments, 400);
    setTimeout(injectButtonsForAnswersWithComments, 900);
    if ("requestIdleCallback" in window) {
      requestIdleCallback(() => injectButtonsForAnswersWithComments());
    }
    startObserver();
    log("Boot complete");
  } catch (e) {
    console.error("[AUTOCOMBAT] boot error:", e);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
