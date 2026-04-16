/* —— Configuration: set WORKER_URL for production / GitHub Pages —— */
const CONFIG = {
  /** "worker" = Cloudflare Worker . "local" = browser calls OpenAI (needs OPENAI_API_KEY). */
  API_MODE: "worker",
  WORKER_URL: "https://loreal-chatbot.aryankn29.workers.dev/",
  OPENAI_MODEL: "gpt-4o-mini",
  OPENAI_CHAT_COMPLETIONS_URL: "https://api.openai.com/v1/chat/completions",
  /** Max user+assistant messages kept (not counting system). */
  MAX_HISTORY_MESSAGES: 24,
};

const SYSTEM_PROMPT = `You are "L'Oréal Beauty Advisor," a helpful, polished assistant for a public educational demo.

Scope — ONLY answer questions about:
- L'Oréal Group brands, products, and product categories (makeup, skincare, haircare, fragrance)
- Beauty routines, layering order, and general how-to guidance tied to those topics
- Ingredients or product-type education when framed for beauty (e.g., serums vs creams, SPF basics)
- Personalized routine ideas and product recommendations framed as general guidance (not guaranteed matches)

Refusal — If the user asks about anything outside this scope (e.g., politics, coding homework, unrelated companies, medical diagnosis, or illegal topics), politely decline in one short paragraph and invite them to ask about L'Oréal or beauty instead.

Safety & accuracy:
- Do not claim real-time stock, exact prices, or store availability.
- Do not claim dermatologist-grade diagnosis or certainty; encourage professional care for concerning skin conditions.
- Avoid unsafe medical advice.
- You may use emojis sparingly (at most one or two per reply) when it fits the tone.

Tone: warm, concise, luxury-beauty appropriate. Structure answers with short paragraphs or bullet points when helpful.`;

const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const messagesContainer = document.getElementById("messagesContainer");
const errorBanner = document.getElementById("errorBanner");
const sendBtn = document.getElementById("sendBtn");
const yearEl = document.getElementById("year");

/** @type {{ role: 'user' | 'assistant', content: string }[]} */
let apiHistory = [];

function getOpenAIKey() {
  return typeof window !== "undefined" && window.OPENAI_API_KEY
    ? window.OPENAI_API_KEY
    : "";
}

function trimHistory(messages) {
  if (messages.length <= CONFIG.MAX_HISTORY_MESSAGES) return messages;
  return messages.slice(-CONFIG.MAX_HISTORY_MESSAGES);
}

function buildApiPayload() {
  return {
    model: CONFIG.OPENAI_MODEL,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...trimHistory(apiHistory)],
  };
}

function setError(message) {
  if (!message) {
    errorBanner.hidden = true;
    errorBanner.textContent = "";
    return;
  }
  errorBanner.hidden = false;
  errorBanner.textContent = message;
}

function parseAssistantContent(data) {
  const choice = data && data.choices && data.choices[0];
  const msg = choice && choice.message;
  if (msg && typeof msg.content === "string") return msg.content.trim();
  if (choice && typeof choice.text === "string") return choice.text.trim();
  return "";
}

async function callOpenAIViaWorker(body) {
  const url = CONFIG.WORKER_URL;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Invalid response from assistant service.");
  }
  if (!res.ok) {
    const errMsg =
      (data.error &&
        (typeof data.error === "string"
          ? data.error
          : data.error.message)) ||
      res.statusText;
    throw new Error(typeof errMsg === "string" ? errMsg : "Request failed.");
  }
  if (data.error && !data.choices) {
    const errMsg =
      typeof data.error === "string"
        ? data.error
        : data.error.message || "Assistant service error.";
    throw new Error(errMsg);
  }
  return data;
}

async function callOpenAIDirect(body) {
  const key = getOpenAIKey();
  if (!key) {
    throw new Error(
      "Local mode requires OPENAI_API_KEY (e.g. from secrets.js). For production, use API_MODE: 'worker'."
    );
  }
  const res = await fetch(CONFIG.OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + key,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Invalid response from OpenAI.");
  }
  if (!res.ok) {
    const errMsg =
      (data.error && data.error.message) || res.statusText || "OpenAI error";
    throw new Error(errMsg);
  }
  return data;
}

async function requestCompletion(body) {
  if (CONFIG.API_MODE === "local") {
    return callOpenAIDirect(body);
  }
  return callOpenAIViaWorker(body);
}

function createUserBubble(text) {
  const row = document.createElement("div");
  row.className = "msg-row user";
  const stack = document.createElement("div");
  stack.className = "msg-stack msg-stack--user";
  const meta = document.createElement("span");
  meta.className = "msg-meta";
  meta.textContent = "You";
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble user";
  bubble.textContent = text;
  stack.appendChild(meta);
  stack.appendChild(bubble);
  row.appendChild(stack);
  return row;
}

function createAssistantBubbleContent(text) {
  const row = document.createElement("div");
  row.className = "msg-row assistant";
  const stack = document.createElement("div");
  stack.className = "msg-stack msg-stack--assistant";
  const meta = document.createElement("span");
  meta.className = "msg-meta";
  meta.textContent = "Advisor";
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble assistant";
  bubble.textContent = text;
  stack.appendChild(meta);
  stack.appendChild(bubble);
  row.appendChild(stack);
  return row;
}

function createLoadingAssistant() {
  const row = document.createElement("div");
  row.className = "msg-row assistant";
  const stack = document.createElement("div");
  stack.className = "msg-stack msg-stack--assistant";
  const meta = document.createElement("span");
  meta.className = "msg-meta";
  meta.textContent = "Advisor";
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble assistant loading";
  bubble.setAttribute("aria-busy", "true");
  bubble.innerHTML =
    '<span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span> Thinking…';
  stack.appendChild(meta);
  stack.appendChild(bubble);
  row.appendChild(stack);
  return { row, bubble };
}

function createQuestionEcho(text) {
  const wrap = document.createElement("div");
  wrap.className = "question-echo";
  const label = document.createElement("span");
  label.className = "question-echo-label";
  label.textContent = "Your question";
  const line = document.createElement("p");
  line.textContent = text;
  wrap.appendChild(label);
  wrap.appendChild(line);
  return wrap;
}

function appendWelcome() {
  const row = createAssistantBubbleContent(
    "Hello — I'm your L'Oréal Beauty Advisor. Ask about products, routines, skincare, makeup, hair, or fragrance. I can also suggest personalized routine ideas based on what you share."
  );
  const turn = document.createElement("div");
  turn.className = "turn";
  turn.appendChild(row);
  messagesContainer.appendChild(turn);
}

function scrollToBottom() {
  const el = document.getElementById("chatWindow");
  if (el) el.scrollTop = el.scrollHeight;
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = (userInput.value || "").trim();
  if (!text) return;

  setError("");
  userInput.value = "";
  sendBtn.disabled = true;

  const turn = document.createElement("div");
  turn.className = "turn";
  turn.appendChild(createUserBubble(text));
  turn.appendChild(createQuestionEcho(text));
  const { row: loadingRow, bubble: loadingBubble } = createLoadingAssistant();
  turn.appendChild(loadingRow);
  messagesContainer.appendChild(turn);
  scrollToBottom();

  apiHistory.push({ role: "user", content: text });

  const payload = buildApiPayload();

  try {
    const data = await requestCompletion(payload);
    const reply = parseAssistantContent(data);
    if (!reply) {
      throw new Error("Unexpected response from assistant. Please try again.");
    }
    apiHistory.push({ role: "assistant", content: reply });
    loadingBubble.removeAttribute("aria-busy");
    loadingBubble.classList.remove("loading");
    loadingBubble.innerHTML = "";
    loadingBubble.textContent = reply;
  } catch (err) {
    const msg =
      err && err.message
        ? err.message
        : "Something went wrong. Please try again.";
    setError(msg);
    const fallback =
      "I couldn't complete that request. Check your connection and Worker URL (or your API key in local mode), then try again.";
    apiHistory.push({ role: "assistant", content: fallback });
    loadingBubble.removeAttribute("aria-busy");
    loadingBubble.classList.remove("loading");
    loadingBubble.innerHTML = "";
    loadingBubble.textContent = fallback;
  } finally {
    sendBtn.disabled = false;
    userInput.focus();
    scrollToBottom();
  }
});

if (yearEl) {
  yearEl.textContent = String(new Date().getFullYear());
}

appendWelcome();
userInput.focus();
