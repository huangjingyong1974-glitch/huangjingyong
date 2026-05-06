const apiKeyInput = document.querySelector("#apiKey");
const modelInput = document.querySelector("#modelName");
const connectBtn = document.querySelector("#connectBtn");
const disconnectBtn = document.querySelector("#disconnectBtn");
const connectionState = document.querySelector("#connectionState");
const modeButtons = [...document.querySelectorAll(".mode-card")];
const childAgeInput = document.querySelector("#childAge");
const levelInput = document.querySelector("#level");
const startLessonBtn = document.querySelector("#startLessonBtn");
const transcript = document.querySelector("#transcript");
const form = document.querySelector("#messageForm");
const messageInput = document.querySelector("#messageInput");
const micBtn = document.querySelector("#micBtn");
const voiceMeter = document.querySelector("#voiceMeter");
const lessonLabel = document.querySelector("#lessonLabel");
const teacherTitle = document.querySelector("#teacherTitle");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

const prompts = {
  chat: {
    label: "日常对话",
    title: "今天想聊什么？",
    opener: "Start a short daily conversation. Ask one simple English question first.",
  },
  listening: {
    label: "听力理解",
    title: "听一句，答一个小问题",
    opener:
      "Give the child one very short listening sentence in English, then ask a multiple-choice comprehension question. Keep it playful.",
  },
  words: {
    label: "单词记忆",
    title: "一起记住 5 个常用词",
    opener:
      "Teach five useful daily English words with Chinese meanings, one tiny example sentence each, then quiz the child.",
  },
};

let socket = null;
let currentMode = "chat";
let recognition = null;
let lastTeacherBubble = null;
let setupReady = false;

apiKeyInput.value = localStorage.getItem("geminiApiKey") || "";
modelInput.value = localStorage.getItem("geminiModel") || modelInput.value;
if (modelInput.value === "gemini-2.0-flash-live-001") {
  modelInput.value = "gemini-3.1-flash-live-preview";
  localStorage.setItem("geminiModel", modelInput.value);
}

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    modeButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    currentMode = button.dataset.mode;
    lessonLabel.textContent = prompts[currentMode].label;
    teacherTitle.textContent = prompts[currentMode].title;
  });
});

connectBtn.addEventListener("click", connectGemini);
disconnectBtn.addEventListener("click", disconnectGemini);
startLessonBtn.addEventListener("click", startLesson);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  messageInput.value = "";
  sendChildText(text);
});

micBtn.addEventListener("click", toggleSpeechRecognition);

function connectGemini() {
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value.trim();
  if (!apiKey) {
    addBubble("system", "提示", "请先粘贴 Gemini API Key。");
    return;
  }

  localStorage.setItem("geminiApiKey", apiKey);
  localStorage.setItem("geminiModel", model);
  setConnection("连接中", true);

  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
  socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    socket.send(
      JSON.stringify({
        config: {
          model: `models/${model}`,
          responseModalities: ["AUDIO"],
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [
              {
                text: buildSystemInstruction(),
              },
            ],
          },
        },
      }),
    );
    setConnection("配置中", true);
  });

  socket.addEventListener("message", handleGeminiMessage);
  socket.addEventListener("close", () => {
    setConnection("未连接", false);
    socket = null;
    setupReady = false;
  });
  socket.addEventListener("error", () => {
    addBubble("system", "连接失败", "Gemini Live 连接没有成功。请检查 API key、模型名称和网络。");
    setConnection("未连接", false);
  });
}

function disconnectGemini() {
  if (socket) socket.close();
}

function setConnection(label, connected) {
  connectionState.textContent = label;
  connectionState.style.color = connected ? "#0f766e" : "#b45309";
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;
}

function startLesson() {
  const modePrompt = prompts[currentMode].opener;
  const starter = `${modePrompt}\nChild age: ${childAgeInput.value}. Level: ${levelInput.value}.`;
  if (isSocketReady()) {
    sendToGemini(starter);
  } else {
    addBubble("teacher", "Sunny", localFallback(currentMode));
  }
}

function sendChildText(text) {
  addBubble("child", "孩子", text);
  if (isSocketReady()) {
    sendToGemini(`The child says: "${text}". Reply as the English teacher.`);
  } else {
    addBubble("system", "离线练习", "还没有连接 Gemini。我先记录孩子的话，连接后就能实时对话。");
  }
}

function sendToGemini(text) {
  lastTeacherBubble = addBubble("teacher", "Sunny", "");
  socket.send(
    JSON.stringify({
      realtimeInput: {
        text,
      },
    }),
  );
}

function handleGeminiMessage(event) {
  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch {
    return;
  }

  if (payload.setupComplete) {
    setupReady = true;
    setConnection("已连接", true);
    addBubble("system", "连接成功", "Sunny 老师已经上线。点击“开始这一课”就可以练习。");
    return;
  }

  const parts = payload.serverContent?.modelTurn?.parts || [];
  const text = parts.map((part) => part.text || "").join("");
  const outputTranscription = payload.serverContent?.outputTranscription?.text || "";
  if (text) {
    appendTeacherText(text);
  }
  if (outputTranscription) {
    appendTeacherText(outputTranscription);
  }
  if (payload.serverContent?.turnComplete) {
    lastTeacherBubble = null;
  }
}

function appendTeacherText(text) {
  if (!lastTeacherBubble) {
    lastTeacherBubble = addBubble("teacher", "Sunny", "");
  }
  const paragraph = lastTeacherBubble.querySelector("p");
  paragraph.textContent += text;
  transcript.scrollTop = transcript.scrollHeight;

  if ("speechSynthesis" in window) {
    clearTimeout(appendTeacherText.timer);
    appendTeacherText.timer = setTimeout(() => speak(paragraph.textContent), 500);
  }
}

function speak(text) {
  const englishOnly = text.replace(/[\u4e00-\u9fff]+/g, "");
  const utterance = new SpeechSynthesisUtterance(englishOnly || text);
  utterance.lang = "en-US";
  utterance.rate = 0.88;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function toggleSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    addBubble("system", "浏览器提示", "这个浏览器不支持语音识别。可以先用文字输入练习。");
    return;
  }

  if (recognition) {
    recognition.stop();
    recognition = null;
    micBtn.classList.remove("recording");
    voiceMeter.classList.remove("listening");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    micBtn.classList.add("recording");
    voiceMeter.classList.add("listening");
  };
  recognition.onend = () => {
    micBtn.classList.remove("recording");
    voiceMeter.classList.remove("listening");
    recognition = null;
  };
  recognition.onerror = () => {
    addBubble("system", "麦克风提示", "没有听清楚，可以再点一次麦克风。");
  };
  recognition.onresult = (event) => {
    const text = event.results[0][0].transcript;
    sendChildText(text);
  };
  recognition.start();
}

function buildSystemInstruction() {
  return `
You are Sunny, a patient English teacher for a Chinese-native child.
The child is ${childAgeInput.value} years old and the current level is ${levelInput.value}.
Use simple, warm English first. Add short Chinese support only when helpful.
Keep each reply short: 1-3 sentences.
Correct gently by repeating the child's sentence in a better version.
Never overwhelm the child. Ask one question at a time.
Current lesson mode: ${prompts[currentMode].label}.
`;
}

function localFallback(mode) {
  if (mode === "listening") {
    return "Listen: The red bus is big.\nQuestion: What color is the bus?\nA. red  B. blue  C. green";
  }
  if (mode === "words") {
    return "今天的 5 个词：apple 苹果, water 水, book 书, happy 开心, school 学校。\nCan you say: I have a book?";
  }
  return "Hi! What did you eat today? You can answer: I ate rice.";
}

function addBubble(type, speaker, text) {
  const bubble = document.createElement("article");
  bubble.className = `bubble ${type}`;
  bubble.innerHTML = `<strong></strong><p></p>`;
  bubble.querySelector("strong").textContent = speaker;
  bubble.querySelector("p").textContent = text;
  transcript.append(bubble);
  transcript.scrollTop = transcript.scrollHeight;
  return bubble;
}

function isSocketReady() {
  return setupReady && socket && socket.readyState === WebSocket.OPEN;
}
