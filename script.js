/* रैपbot: navigation, chat, Groq calls, expand panels and the Learn page. */
"use strict";

/* ===== Groq settings (browser version of the Python Groq snippet) ===== */
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// Any model from https://console.groq.com/docs/models works here.
// For a Llama model (e.g. "llama-3.3-70b-versatile"), set REASONING_EFFORT = null
// and MAX_COMPLETION_TOKENS = 200 (the JSON also explains the user's bar).
const MODEL = "openai/gpt-oss-120b";
const TEMPERATURE = 1;
const TOP_P = 1;
// gpt-oss thinks before it answers, and that thinking counts toward this limit.
const MAX_COMPLETION_TOKENS = 2048;
const REASONING_EFFORT = "medium"; // reasoning models only, null for others
const REQUEST_TIMEOUT_MS = 30000;

const MAX_BAR_LENGTH = 300;
const KEY_STORAGE = "rapbot_groq_key";

/* ===== Bot text ===== */
const MSG = {
  opener: "Homie, spit some bars",
  memory: "I don't remember past bars, I move on. Type a bar if you want the next one, or say 'expand' to explain it, or 'rap it again' to get a new bar.",
  empty: "Yo, that's empty fam. Drop a bar first.",
  tooLong: "Whoa bro, that's a whole verse. One bar, under 300 characters.",
  noKey: "Hold up homie, paste your Groq API key up top first.",
  nothingToExpand: "No bar to break down yet, fam. Spit one first.",
  failed: "Mic went quiet, try again homie.",
  badKey: "Your Groq key looks invalid. Hit 'Clear key' and paste a fresh one.",
  rateLimit: "Groq's rate limit kicked in, give it a few seconds.",
};

/* ===== System prompt ===== */
const BASE_PROMPT = `You are रैपbot, a rap partner. The user sends one bar (one line of rap). You answer with ONLY the next bar, plus a short breakdown of both bars.

Rules for your bar:
- The "reply" is exactly one bar of about 8 to 16 words. No intro, no explanation, no extra text inside it.
- Match the user's bar in rhythm, syllable count and rhyme sound, so your bar flows as the next line.
- Use rap slang where it fits naturally (homie, bro, fam, bars, flow, spit, drop, no cap, on God). Never force it.
- Never use cursing, profanity, slurs or sexual content. Keep it clean.
- Never insult or target real people.
- If the user raps in Hindi or Hinglish, reply in the same language and script.
- Stay on topic: rap and bars only. If the message is not a bar or is off topic, reply with one short slang line that brings them back to rapping.
- You have no memory. If the user asks about a previous line, earlier bars, or anything said before, reply exactly: "${MSG.memory}"
- If the user says "rap it again", drop a fresh, original bar on any rap theme.

Rules for explaining the user's bar:
- In one or two short, simple sentences, say what the user's bar means and which rhymes or technique it uses (name the rhyming words, internal rhymes, wordplay and so on).
- Sound like a friendly homie explaining it to a beginner. Keep it clean and encouraging.
- If the message is not really a bar, say that briefly.

Output format: return only a JSON object, with no markdown and no code fences:
{"reply": "your one bar", "type": "rhyme scheme or technique name of your bar, e.g. AABB, ABAB, internal rhyme, multi-syllable rhyme, punchline, wordplay, double meaning", "technique": "one short line naming the technique used in your bar", "user_type": "rhyme scheme or technique name of the user's bar", "user_explain": "one or two short sentences explaining the user's bar"}`;

const MODES = {
  beginner: {
    label: "Beginner Mode",
    prompt: "Mode: Beginner. Use simple end rhymes with common words (like cat/hat, day/way). Keep the vocabulary easy and the rhythm clear and steady.",
  },
  intermediate: {
    label: "Intermediate Mode",
    prompt: "Mode: Intermediate. Use multi-syllable rhymes and internal rhymes. Vary the rhyme scheme between replies (AABB, ABAB, internal, multi-syllable) instead of always using the same one.",
  },
  advanced: {
    label: "Advanced Mode",
    prompt: "Mode: Advanced. Use punchlines, double meanings, wordplay and battle-style comebacks. Be sharp and witty, but never insult real people.",
  },
};

/* ===== Profanity filter (applied to user input and bot replies before display) ===== */
const PROFANITY = [
  "f+u+c+k+\\w*", "fuk\\w*", "fck\\w*", "motherf\\w*", "wtf", "stfu",
  "sh+i+t+\\w*", "bullshit\\w*", "b+i+t+c+h+\\w*", "bastards?", "asshole\\w*", "ass",
  "arsehole\\w*", "damn\\w*", "goddamn\\w*", "dicks?", "dickhead\\w*", "cocks?", "cocksucker\\w*",
  "cunts?", "puss(y|ies)", "whores?", "sluts?", "twats?", "wank\\w*", "pricks?", "piss\\w*",
  "n+i+g+g+(a|er)s?\\w*", "fag(s|got\\w*)?", "retard\\w*",
  // Common Hindi gaali, written in English letters
  "chutiy\\w*", "madarchod\\w*", "maderchod\\w*", "behenchod\\w*", "bhenchod\\w*",
  "bhosd\\w*", "bsdk", "gaand\\w*", "gandu\\w*", "lund", "lauda", "lavda", "randi\\w*", "harami\\w*",
];
const PROFANITY_RE = new RegExp("\\b(?:" + PROFANITY.join("|") + ")\\b", "gi");

function clean(text) {
  return String(text || "").replace(PROFANITY_RE, "***");
}

/* Questions about earlier bars are answered locally, without calling the API */
const MEMORY_RE = /\b(previous|last|earlier|prior|past)\s+(line|lines|bar|bars|verse|reply|message|rhyme)\b|\bwhat did (i|you) (just )?(say|spit|write|rap)\b|\brepeat (that|it)\b|\bsay that again\b/i;
const EXPAND_RE = /^(expand|explain)( it| that| this)?$/;

/* ===== Learn content ===== */
const LEARN_SECTIONS = [
  {
    era: "1970s",
    title: "Where rap started",
    text: [
      "Rap was born at block parties in the Bronx, New York, in the early 1970s.",
      "DJ Kool Herc played the drum break of a record on two turntables, one after the other, so the best dance part lasted much longer.",
      "Those long breaks gave people a beat to talk over.",
      "The MC, or master of ceremonies, held the mic to hype up the crowd, and those shout-outs slowly grew into full rhymes.",
    ],
  },
  {
    era: "1979",
    title: "The first big records",
    text: [
      "In 1979, the Sugarhill Gang released \"Rapper's Delight.\"",
      "It became one of the first rap songs to be a hit on the radio.",
      "For the first time, people far from the Bronx heard rap.",
      "Through records, radio and later TV, hip-hop spread across America and then around the world.",
    ],
  },
  {
    era: "1980s to 1990s",
    title: "Old school to golden age",
    text: [
      "Grandmaster Flash and the Furious Five released \"The Message\" in 1982, and it showed that rap could tell real stories about city life.",
      "Run-DMC brought a harder sound with heavy drums and rock guitars, and became huge stars.",
      "Public Enemy used rap to speak about politics and society.",
      "In the late 80s and 90s, often called the golden age, rappers focused on clever lyrics and complex rhymes.",
    ],
  },
  {
    era: "1990s to today",
    title: "Regional styles and new sounds",
    text: [
      "In the 1990s, East Coast rap from New York and West Coast rap from Los Angeles each had their own sound and their own stars.",
      "Gangsta rap told raw stories about street life.",
      "Later, the South gave us trap, with booming 808 bass and fast hi-hats.",
      "Drill grew out of Chicago with dark, heavy beats, and melodic rap mixed singing with rapping.",
    ],
  },
  {
    era: "India",
    title: "Rap in India",
    text: [
      "Indian rap started growing in the 1990s with artists like Baba Sehgal, and later Punjabi rappers like Bohemia and Yo Yo Honey Singh.",
      "In Mumbai, street rappers like Naezy and Divine rapped in Hindi about their real lives.",
      "Their story inspired the film Gully Boy (2019), which brought desi hip-hop to the whole country.",
      "Today, people rap in Hindi, Punjabi, Tamil, Malayalam, Marathi and many other languages.",
    ],
  },
  {
    era: "The basics",
    title: "Basic terms",
    terms: [
      ["Bar", "One line of rap, usually the length of one beat measure."],
      ["Flow", "The rhythm and style of how your words ride the beat."],
      ["Rhyme scheme", "The pattern of rhymes: AABB means two lines in a row rhyme, ABAB means every other line rhymes."],
      ["Punchline", "A sharp, clever line that hits hard, often with a twist at the end."],
      ["Hook", "The catchy part of a song that repeats, like a chorus."],
      ["Battle rap", "Two rappers take turns spitting bars at each other to see who has the better lines."],
    ],
  },
];

/* ===== Elements ===== */
const $ = (id) => document.getElementById(id);
const views = { home: $("home"), chat: $("chat"), learn: $("learn") };
const messages = $("messages");
const barForm = $("bar-form");
const barInput = $("bar-input");
const sendBtn = $("send-btn");
const keyForm = $("key-form");
const keyInput = $("key-input");
const keyStatus = $("key-status");
const modeBadge = $("mode-badge");

/* ===== State ===== */
let currentMode = null;
let chatSession = 0;   // bumps on reset so late replies don't land in a new chat
let busy = false;
let learnIndex = 0;
let memoryKey = null;  // fallback when sessionStorage is blocked
let useLocalKey = true; // "Clear key" also ignores config.local.js until reload
let panelCount = 0;
let pairCount = 0;     // links a user bar and the bot reply to it

const finePointer = window.matchMedia("(pointer: fine)").matches;

/* ===== Navigation ===== */
function showView(name) {
  Object.entries(views).forEach(([key, el]) => { el.hidden = key !== name; });
  document.body.dataset.view = name;
  $("main").scrollTop = 0;
}

function openChat(mode, fresh) {
  if (fresh || mode !== currentMode || !messages.hasChildNodes()) {
    currentMode = mode;
    resetChat();
  }
  modeBadge.textContent = MODES[currentMode].label;
  updateKeyUI();
  showView("chat");
  if (finePointer) (getKey() ? barInput : keyInput).focus();
}

function openLearn() {
  renderLearn();
  showView("learn");
}

/* ===== API key (sessionStorage only, lasts for this tab) ===== */
function getKey() {
  try {
    const saved = sessionStorage.getItem(KEY_STORAGE);
    if (saved) return saved;
  } catch (e) { /* storage blocked */ }
  if (memoryKey) return memoryKey;
  const local = typeof window.RAPBOT_LOCAL_KEY === "string" ? window.RAPBOT_LOCAL_KEY.trim() : "";
  return useLocalKey && local ? local : null;
}

function saveKey(key) {
  memoryKey = key;
  try { sessionStorage.setItem(KEY_STORAGE, key); } catch (e) { /* memory only */ }
}

function clearKey() {
  memoryKey = null;
  useLocalKey = false;
  try { sessionStorage.removeItem(KEY_STORAGE); } catch (e) { /* nothing stored */ }
}

function updateKeyUI() {
  const hasKey = Boolean(getKey());
  keyForm.hidden = hasKey;
  keyStatus.hidden = !hasKey;
}

/* ===== Chat rendering ===== */
function scrollChat() {
  messages.scrollTop = messages.scrollHeight;
}

function addMessage(role, text) {
  const msg = document.createElement("div");
  msg.className = "msg msg-" + role;
  const p = document.createElement("p");
  p.className = "msg-text";
  p.textContent = text;
  msg.appendChild(p);
  messages.appendChild(msg);
  scrollChat();
  return msg;
}

function detailLine(label, value) {
  const p = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = label + ": ";
  p.append(strong, value);
  return p;
}

function setPanel(btn, panel, open) {
  panel.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
  btn.textContent = open ? "Hide" : "Expand";
}

// Adds an Expand button + hidden panel to a chat bubble (bot reply or user bar).
function attachExpand(msg, lines, pair) {
  const panel = document.createElement("div");
  panel.className = "expand-panel";
  panel.id = "expand-" + (++panelCount);
  lines.forEach(([label, value]) => panel.appendChild(detailLine(label, value)));

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "expand-btn";
  btn.dataset.pair = pair;
  btn.setAttribute("aria-controls", panel.id);
  btn.addEventListener("click", () => {
    setPanel(btn, panel, panel.hidden);
    if (!panel.hidden) msg.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  setPanel(btn, panel, false);
  msg.append(btn, panel);
}

function addExchange(userMsg, result) {
  const pair = String(++pairCount);
  if (result.userExplain) {
    attachExpand(userMsg, [
      ["Type", clean(result.userType) || "unknown"],
      ["Breakdown", clean(result.userExplain)],
    ], pair);
  }
  const botMsg = addMessage("bot", clean(result.reply));
  attachExpand(botMsg, [
    ["Type", clean(result.type) || "unknown"],
    ["Technique", clean(result.technique) || "No breakdown on this one, fam."],
  ], pair);
  scrollChat();
}

function addTyping() {
  const msg = document.createElement("div");
  msg.className = "msg msg-bot msg-typing";
  msg.setAttribute("aria-label", "रैपbot is writing");
  for (let i = 0; i < 3; i++) msg.appendChild(document.createElement("span"));
  messages.appendChild(msg);
  scrollChat();
  return msg;
}

// Typed "expand": opens the latest bot bar and the user bar it answered.
function expandLatest() {
  const botButtons = messages.querySelectorAll(".msg-bot .expand-btn");
  const last = botButtons[botButtons.length - 1];
  if (!last) {
    addMessage("bot", MSG.nothingToExpand);
    return;
  }
  const pairButtons = messages.querySelectorAll(`.expand-btn[data-pair="${last.dataset.pair}"]`);
  pairButtons.forEach((btn) => setPanel(btn, $(btn.getAttribute("aria-controls")), true));
  pairButtons[0].closest(".msg").scrollIntoView({ block: "start", behavior: "smooth" });
}

function resetChat() {
  chatSession++;
  messages.replaceChildren();
  addMessage("bot", MSG.opener);
  barInput.value = "";
  setBusy(false);
}

function setBusy(on) {
  busy = on;
  sendBtn.disabled = on;
  sendBtn.textContent = on ? "..." : "Send";
}

/* ===== Groq call: stateless, sends only the system prompt + current bar ===== */
async function fetchNextBar(bar, mode, key) {
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: BASE_PROMPT + "\n\n" + MODES[mode].prompt },
      { role: "user", content: bar },
    ],
    temperature: TEMPERATURE,
    top_p: TOP_P,
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    stream: false, // the whole JSON is needed before anything can be shown
  };
  if (REASONING_EFFORT) body.reasoning_effort = REASONING_EFFORT;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Groq error", res.status, detail);
      const err = new Error("Groq request failed: " + res.status);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const result = parseBar(data?.choices?.[0]?.message?.content);
    if (!result.reply) throw new Error("Empty reply from Groq");
    return result;
  } finally {
    clearTimeout(timer);
  }
}

// Expects {"reply", "type", "technique", "user_type", "user_explain"};
// falls back to raw text + "unknown" (and no breakdown of the user's bar).
function parseBar(raw) {
  const text = String(raw || "").trim();
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1));
      if (obj && str(obj.reply)) {
        return {
          reply: str(obj.reply).replace(/^["']+|["']+$/g, ""),
          type: str(obj.type) || "unknown",
          technique: str(obj.technique),
          userType: str(obj.user_type) || "unknown",
          userExplain: str(obj.user_explain),
        };
      }
    } catch (e) { /* not valid JSON, use raw text */ }
  }
  return { reply: text, type: "unknown", technique: "", userType: "unknown", userExplain: "" };
}

/* ===== Send a bar ===== */
async function handleSubmit(event) {
  event.preventDefault();
  if (busy) return;

  const text = barInput.value.trim();
  if (!text) {
    addMessage("bot", MSG.empty);
    return;
  }
  if (text.length > MAX_BAR_LENGTH) {
    addMessage("bot", MSG.tooLong);
    return;
  }

  const bar = clean(text);
  const userMsg = addMessage("user", bar);
  barInput.value = "";

  const command = text.toLowerCase().replace(/[^\w\s']/g, "").trim();
  if (EXPAND_RE.test(command)) {
    expandLatest();
    return;
  }
  if (MEMORY_RE.test(text)) {
    addMessage("bot", MSG.memory);
    return;
  }

  const key = getKey();
  if (!key) {
    addMessage("bot", MSG.noKey);
    updateKeyUI();
    keyInput.focus();
    return;
  }

  const session = chatSession;
  setBusy(true);
  const typing = addTyping();
  try {
    const result = await fetchNextBar(bar, currentMode, key);
    if (session !== chatSession) return;
    typing.remove();
    addExchange(userMsg, result);
  } catch (err) {
    if (session !== chatSession) return;
    typing.remove();
    let note = MSG.failed;
    if (err.status === 401) note += " " + MSG.badKey;
    else if (err.status === 429) note += " " + MSG.rateLimit;
    addMessage("bot", note);
  } finally {
    if (session === chatSession) {
      setBusy(false);
      if (finePointer) barInput.focus();
    }
  }
}

/* ===== Learn page ===== */
function renderLearn() {
  const section = LEARN_SECTIONS[learnIndex];
  const total = LEARN_SECTIONS.length;
  const isLast = learnIndex === total - 1;

  $("learn-progress").textContent = `Section ${learnIndex + 1} of ${total}`;
  $("learn-era").textContent = section.era;
  $("learn-fill").style.width = ((learnIndex + 1) / total) * 100 + "%";
  $("learn-title").textContent = section.title;

  const body = $("learn-body");
  body.replaceChildren();
  if (section.terms) {
    const dl = document.createElement("dl");
    dl.className = "learn-terms";
    section.terms.forEach(([term, meaning]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = term;
      dd.textContent = meaning;
      row.append(dt, dd);
      dl.appendChild(row);
    });
    body.appendChild(dl);
  } else {
    section.text.forEach((line) => {
      const p = document.createElement("p");
      p.textContent = line;
      body.appendChild(p);
    });
  }

  $("learn-prev").disabled = learnIndex === 0;
  $("learn-next").hidden = isLast;
  $("learn-start").hidden = !isLast;
}

function stepLearn(delta) {
  const next = learnIndex + delta;
  if (next < 0 || next >= LEARN_SECTIONS.length) return;
  learnIndex = next;
  renderLearn();
}

/* ===== Wiring ===== */
document.querySelectorAll(".mode-panel").forEach((panel) => {
  panel.addEventListener("click", () => openChat(panel.dataset.mode, true));
});

$("logo").addEventListener("click", (e) => {
  e.preventDefault();
  showView("home");
});

$("learn-open").addEventListener("click", openLearn);
$("chat-learn").addEventListener("click", openLearn);
$("chat-back").addEventListener("click", () => showView("home"));

$("learn-prev").addEventListener("click", () => stepLearn(-1));
$("learn-next").addEventListener("click", () => stepLearn(1));
$("learn-chat").addEventListener("click", () => openChat(currentMode || "beginner", false));
$("learn-start").addEventListener("click", () => showView("home"));

document.addEventListener("keydown", (e) => {
  if (views.learn.hidden) return;
  if (e.key === "ArrowRight") stepLearn(1);
  if (e.key === "ArrowLeft") stepLearn(-1);
});

keyForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const key = keyInput.value.trim();
  if (!key) return;
  saveKey(key);
  keyInput.value = "";
  updateKeyUI();
  barInput.focus();
});

$("key-clear").addEventListener("click", () => {
  clearKey();
  updateKeyUI();
  keyInput.focus();
});

barForm.addEventListener("submit", handleSubmit);

showView("home");
