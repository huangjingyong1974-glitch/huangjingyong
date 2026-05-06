const apiKeyInput = document.querySelector("#apiKey");
const modelInput = document.querySelector("#modelName");
const connectBtn = document.querySelector("#connectBtn");
const disconnectBtn = document.querySelector("#disconnectBtn");
const connectionState = document.querySelector("#connectionState");
const modeButtons = [...document.querySelectorAll(".mode-card")];
const childAgeInput = document.querySelector("#childAge");
const levelInput = document.querySelector("#level");
const sceneSelect = document.querySelector("#sceneSelect");
const lessonPlan = document.querySelector("#lessonPlan");
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

const scenes = {
  breakfast: {
    title: "早餐时间",
    goal: "会说想吃什么、喜欢什么。",
    phrases: ["I want milk.", "I like eggs.", "Can I have bread?"],
    words: ["milk", "egg", "bread", "banana", "hungry"],
  },
  school: {
    title: "上学路上",
    goal: "会说今天去学校、带了什么。",
    phrases: ["I go to school.", "This is my bag.", "I have a pencil."],
    words: ["school", "bag", "book", "pencil", "friend"],
  },
  shop: {
    title: "小商店",
    goal: "会说想买什么、颜色和数量。",
    phrases: ["I want an apple.", "It is red.", "Two apples, please."],
    words: ["apple", "water", "toy", "red", "two"],
  },
  bedtime: {
    title: "睡前故事",
    goal: "会说晚安、感受和简单故事词。",
    phrases: ["I am sleepy.", "Good night.", "The moon is bright."],
    words: ["moon", "star", "sleepy", "story", "night"],
  },
};

let socket = null;
let currentMode = "chat";
let recognition = null;
let lastTeacherBubble = null;
let setupReady = false;
let apiMode = null;
let intentionalDisconnect = false;
let setupTimer = null;

apiKeyInput.value = localStorage.getItem("geminiApiKey") || "";
modelInput.value = localStorage.getItem("geminiModel") || modelInput.value;
if (!isLiveModel(modelInput.value)) {
  modelInput.value = "gemini-2.5-flash-native-audio-preview-12-2025";
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

sceneSelect.addEventListener("change", updateLessonPlan);
updateLessonPlan();

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
  intentionalDisconnect = false;

  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
  socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    socket.send(
      JSON.stringify({
        setup: {
          model: `models/${model}`,
          generationConfig: {
            responseModalities: ["AUDIO"],
          },
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
    setupTimer = window.setTimeout(() => {
      if (!setupReady) {
        enableRestFallback("Live 配置等待超时，已切换到稳定文字模式。通常是模型名或当前 API key 的 Live 权限不支持。");
      }
    }, 8000);
  });

  socket.addEventListener("message", handleGeminiMessage);
  socket.addEventListener("close", (event) => {
    window.clearTimeout(setupTimer);
    if (intentionalDisconnect) {
      intentionalDisconnect = false;
      return;
    }
    const detail = event.reason ? `原因：${event.reason}` : `代码：${event.code}`;
    if (!setupReady) {
      enableRestFallback(`Live 连接被关闭，已切换到稳定文字模式。${detail}`);
      return;
    }
    addBubble("system", "连接已断开", `Gemini 关闭了连接。${detail}`);
    setConnection("未连接", false);
    socket = null;
    setupReady = false;
    apiMode = null;
  });
  socket.addEventListener("error", () => {
    window.clearTimeout(setupTimer);
    enableRestFallback("Live 连接没有成功，已切换到稳定文字模式。");
  });
}

function disconnectGemini() {
  intentionalDisconnect = true;
  if (socket) socket.close();
  window.clearTimeout(setupTimer);
  socket = null;
  setupReady = false;
  apiMode = null;
  setConnection("未连接", false);
}

function setConnection(label, connected) {
  connectionState.textContent = label;
  connectionState.style.color = connected ? "#0f766e" : "#b45309";
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;
}

function startLesson() {
  const modePrompt = prompts[currentMode].opener;
  const starter = `${modePrompt}\n${lessonContext()}\nStart now with one short sentence and one question.`;
  if (isSocketReady()) {
    sendToGemini(starter);
  } else {
    addBubble("teacher", "Sunny", localFallback(currentMode));
  }
}

function sendChildText(text) {
  addBubble("child", "孩子", text);
  if (isSocketReady()) {
    sendToGemini(`The child says: "${text}". ${lessonContext()} Reply as the English teacher.`);
  } else {
    addBubble("system", "离线练习", "还没有连接 Gemini。我先记录孩子的话，连接后就能实时对话。");
  }
}

function sendToGemini(text) {
  lastTeacherBubble = addBubble("teacher", "Sunny", "");
  if (apiMode === "rest") {
    sendRestMessage(text);
    return;
  }
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
    window.clearTimeout(setupTimer);
    setupReady = true;
    apiMode = "live";
    setConnection("已连接", true);
    addBubble("system", "连接成功", "Sunny 老师已经上线。点击“开始这一课”就可以练习。");
    return;
  }

  if (payload.goAway) {
    addBubble("system", "Live 提醒", "Gemini Live 会话即将结束，可以断开后重新连接。");
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
${lessonContext()}
`;
}

function localFallback(mode) {
  const scene = scenes[sceneSelect.value];
  if (mode === "listening") {
    return `Listen: ${scene.phrases[0]}\nQuestion: Which word did you hear?\nA. ${scene.words[0]}  B. tiger  C. train`;
  }
  if (mode === "words") {
    return `今天的 5 个词：${scene.words.join(", ")}。\nCan you say: ${scene.phrases[0]}`;
  }
  return `Hi! ${scene.phrases[0]}\nCan you try?`;
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
  return apiMode === "rest" || (setupReady && socket && socket.readyState === WebSocket.OPEN);
}

function isLiveModel(model) {
  return /live|native-audio/.test(model);
}

function updateLessonPlan() {
  const scene = scenes[sceneSelect.value];
  lessonPlan.innerHTML = `
    <span><strong>${scene.title}</strong>：${scene.goal}</span>
    <span>句型：${scene.phrases.join(" / ")}</span>
    <span>单词：${scene.words.join(", ")}</span>
  `;
}

function lessonContext() {
  const scene = scenes[sceneSelect.value];
  return `
Lesson scene: ${scene.title}.
Learning goal: ${scene.goal}
Target phrases: ${scene.phrases.join(" | ")}
Vocabulary: ${scene.words.join(", ")}
Mode: ${prompts[currentMode].label}.
Child age: ${childAgeInput.value}. Level: ${levelInput.value}.
Use only this scene's target phrases and vocabulary unless the child asks for more.
`;
}

function enableRestFallback(message) {
  if (apiMode === "rest") return;
  apiMode = "rest";
  setupReady = false;
  if (socket) {
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
    socket = null;
  }
  setConnection("文字模式", true);
  addBubble("system", "已连接", message);
}

async function sendRestMessage(text) {
  const apiKey = apiKeyInput.value.trim();
  const restModel = "gemini-2.5-flash";
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${restModel}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: buildSystemInstruction() }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text }],
            },
          ],
          generationConfig: {
            temperature: 0.8,
          },
        }),
      },
    );
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error?.message || "请求失败");
    }
    const answer = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
    appendTeacherText(answer || "I am here. Let's try again!");
  } catch (error) {
    if (lastTeacherBubble) {
      lastTeacherBubble.querySelector("p").textContent = "连接 Gemini 时出错了。请检查 API Key 是否正确。";
    }
    addBubble("system", "错误详情", error.message);
  }
}
