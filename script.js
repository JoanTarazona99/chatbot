"use strict";

const INITIAL_GREETING =
  "Здравствуйте! Я учебный чат-бот поддержки. Выберите тему или задайте вопрос.";
const FALLBACK =
  "Пока нет подходящего ответа. Выберите тему, укажите номер учебного заказа или запросите оператора.";
const OPERATOR_MESSAGE =
  "Это демонстрационная функция. Реальный запрос не отправляется, реальный оператор не подключается.";
const STORAGE_KEYS = {
  history: "lab4-chat-history",
  faq: "lab4-faq-edits",
  ratings: "lab4-ratings"
};
const COMMENT_LIMIT = 240;

const topics = {
  "Оплата": [
    {
      id: "payment-methods",
      question: "Какие способы оплаты доступны?",
      answer: "В нашем учебном магазине предусмотрена оплата банковской картой."
    }
  ],
  "Доставка": [
    {
      id: "delivery-time",
      question: "Какие сроки доставки?",
      answer: "Примерный срок доставки — 3–5 рабочих дней. Точный срок уточняется при оформлении заказа."
    },
    {
      id: "track-order",
      question: "Как отследить заказ?",
      answer: "В учебном сценарии статус заказа можно посмотреть в разделе “Мои заказы”."
    }
  ],
  "Аккаунт": [
    {
      id: "recover-password",
      question: "Как восстановить пароль?",
      answer: "На странице входа нажмите “Забыли пароль?” и следуйте инструкциям."
    }
  ]
};

const demoOrders = {
  "1001": { status: "Передан в доставку", delivery: "Ожидаемая доставка: 25 ноября" },
  "1002": { status: "Собирается", delivery: "Ожидаемая доставка: 28 ноября" }
};

const messagesElement = document.querySelector("#messages");
const quickActionsElement = document.querySelector("#quick-actions");
const chatForm = document.querySelector("#chat-form");
const messageInput = document.querySelector("#message-input");
const restartButton = document.querySelector("#restart-button");
const storageNotice = document.querySelector("#storage-notice");
const faqSelector = document.querySelector("#faq-selector");
const faqAnswer = document.querySelector("#faq-answer");
const faqEditorStatus = document.querySelector("#faq-editor-status");
const scheduleTime = document.querySelector("#schedule-time");
const faqMatchStatus = document.querySelector("#faq-match-status");

let storageAvailable = true;
let nextMessageNumber = 0;
let messages = [];
let ratings = [];
let faqEdits = {};
let conversationGeneration = 0;
const pendingFaqRequests = new Set();

function showStorageWarning(details) {
  storageAvailable = false;
  storageNotice.hidden = false;
  storageNotice.textContent =
    `Локальное хранилище недоступно. Прототип продолжит работу только в этой вкладке; данные после закрытия не сохранятся. ${details}`;
}

function initializeStorage() {
  try {
    const probe = `${STORAGE_KEYS.history}-probe`;
    localStorage.setItem(probe, "ok");
    localStorage.removeItem(probe);
  } catch (error) {
    showStorageWarning(`Причина: ${error.message}`);
  }
}

function readStored(key, fallback) {
  if (!storageAvailable) {
    return fallback;
  }

  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : JSON.parse(stored);
  } catch (error) {
    showStorageWarning(`Не удалось прочитать локальные данные: ${error.message}`);
    return fallback;
  }
}

function writeStored(key, value) {
  if (!storageAvailable) {
    return false;
  }

  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    showStorageWarning(`Не удалось сохранить локальные данные: ${error.message}`);
    return false;
  }
}

function saveHistory() {
  writeStored(STORAGE_KEYS.history, messages);
}

function saveRatings() {
  writeStored(STORAGE_KEYS.ratings, ratings);
}

function saveFaqEdits() {
  return writeStored(STORAGE_KEYS.faq, faqEdits);
}

function allFaqs() {
  return Object.values(topics).flat();
}

function getFaqAnswer(faq) {
  return faqEdits[faq.id] || faq.answer;
}

function findRating(messageId) {
  return ratings.find((rating) => rating.messageId === messageId);
}

function scrollToLatestMessage() {
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

function renderFeedback(message, feedback) {
  const rating = findRating(message.id);

  if (rating) {
    const result = document.createElement("span");
    result.className = "feedback-result";
    result.textContent = rating.vote === "Да"
      ? "Спасибо за оценку!"
      : "Спасибо за обратную связь. Вы можете выбрать другую тему или запросить оператора.";
    feedback.append(result);

    if (rating.commentDone) {
      if (rating.comment) {
        const savedComment = document.createElement("span");
        savedComment.className = "saved-comment";
        savedComment.textContent = `Комментарий: ${rating.comment}`;
        feedback.append(savedComment);
      }
      return;
    }

    const commentLabel = document.createElement("label");
    commentLabel.className = "comment-label";
    commentLabel.textContent = `Комментарий (необязательно, до ${COMMENT_LIMIT} символов)`;

    const commentInput = document.createElement("textarea");
    commentInput.className = "rating-comment";
    commentInput.maxLength = COMMENT_LIMIT;
    commentInput.rows = 2;
    commentInput.placeholder = "Что можно улучшить?";
    commentInput.setAttribute("aria-label", "Необязательный комментарий к оценке");

    const counter = document.createElement("span");
    counter.className = "comment-counter";
    counter.textContent = `0 / ${COMMENT_LIMIT}`;
    commentInput.addEventListener("input", () => {
      if (commentInput.value.length > COMMENT_LIMIT) {
        commentInput.value = commentInput.value.slice(0, COMMENT_LIMIT);
      }
      counter.textContent = `${commentInput.value.length} / ${COMMENT_LIMIT}`;
    });

    const actions = document.createElement("div");
    actions.className = "comment-actions";
    const saveComment = document.createElement("button");
    saveComment.className = "feedback-button";
    saveComment.type = "button";
    saveComment.textContent = "Сохранить комментарий";
    saveComment.addEventListener("click", () => {
      rating.comment = commentInput.value.trim();
      rating.commentDone = true;
      saveRatings();
      renderMessages();
      updateStatistics();
    });

    const skipComment = document.createElement("button");
    skipComment.className = "feedback-button";
    skipComment.type = "button";
    skipComment.textContent = "Без комментария";
    skipComment.addEventListener("click", () => {
      rating.comment = "";
      rating.commentDone = true;
      saveRatings();
      renderMessages();
    });

    actions.append(saveComment, skipComment);
    feedback.append(commentLabel, commentInput, counter, actions);
    return;
  }

  const prompt = document.createElement("span");
  prompt.className = "feedback-prompt";
  prompt.textContent = "Ответ помог?";
  feedback.append(prompt);

  ["Да", "Нет"].forEach((choice) => {
    const button = document.createElement("button");
    button.className = "feedback-button";
    button.type = "button";
    button.textContent = choice;
    button.addEventListener("click", () => {
      if (findRating(message.id)) {
        return;
      }

      ratings.push({
        messageId: message.id,
        vote: choice,
        comment: "",
        commentDone: false
      });
      saveRatings();
      renderMessages();
      updateStatistics();
    });
    feedback.append(button);
  });
}

function renderMessage(message) {
  const row = document.createElement("article");
  row.className = `message-row ${message.sender}`;

  const senderLabel = document.createElement("span");
  senderLabel.className = "message-sender";
  senderLabel.textContent = message.sender === "bot" ? "Помощник" : "Вы";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = message.text;
  row.append(senderLabel, bubble);

  if (message.sourceLabel) {
    const source = document.createElement("span");
    source.className = "answer-source";
    source.textContent = message.sourceLabel;
    row.append(source);
  }

  if (message.rateable) {
    const feedback = document.createElement("div");
    feedback.className = "feedback";
    renderFeedback(message, feedback);
    row.append(feedback);
  }

  messagesElement.append(row);
}

function renderMessages() {
  messagesElement.replaceChildren();
  messages.forEach(renderMessage);
  scrollToLatestMessage();
}

function addMessage(text, sender, options = {}) {
  nextMessageNumber += 1;
  const message = {
    id: `${Date.now()}-${nextMessageNumber}`,
    sender,
    text,
    rateable: Boolean(options.rateable),
    sourceLabel: ["По правилам", "Подбор с помощью ИИ"].includes(options.sourceLabel)
      ? options.sourceLabel
      : ""
  };
  messages.push(message);
  saveHistory();
  renderMessage(message);
  scrollToLatestMessage();
  return message;
}

function createQuickButton(label, action, isPrimary = false) {
  const button = document.createElement("button");
  button.className = `quick-button${isPrimary ? " primary" : ""}`;
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function showTopicMenu() {
  quickActionsElement.replaceChildren();
  Object.keys(topics).forEach((topic) => {
    quickActionsElement.append(
      createQuickButton(topic, () => selectTopic(topic), true)
    );
  });
  quickActionsElement.append(
    createQuickButton("Заказ № 1001", () => lookupOrder("1001"))
  );
  quickActionsElement.append(
    createQuickButton("Оператор", showOperatorSimulation)
  );
}

function showTopicQuestions(topic) {
  quickActionsElement.replaceChildren();
  topics[topic].forEach((faq) => {
    quickActionsElement.append(
      createQuickButton(faq.question, () => askQuestion(faq))
    );
  });
  if (topic === "Доставка") {
    quickActionsElement.append(
      createQuickButton("Заказ № 1001", () => lookupOrder("1001"))
    );
    quickActionsElement.append(
      createQuickButton("Заказ № 1002", () => lookupOrder("1002"))
    );
  }
  quickActionsElement.append(
    createQuickButton("Главное меню", returnToMenu, true)
  );
  quickActionsElement.append(
    createQuickButton("Оператор", showOperatorSimulation)
  );
}

function selectTopic(topic) {
  addMessage(topic, "user");
  addMessage(`Выберите вопрос по теме «${topic}».`, "bot");
  showTopicQuestions(topic);
}

function findFaq(message) {
  const text = message.toLocaleLowerCase("ru-RU");
  const checks = [
    {
      topic: "Доставка",
      faqIndex: 1,
      pattern: /(отслед|отслеж|трек|где\s+(мой|заказ)|статус\s+заказ)/
    },
    {
      topic: "Аккаунт",
      faqIndex: 0,
      pattern: /(парол|восстанов|забыл|забыли|вход|аккаунт)/
    },
    {
      topic: "Оплата",
      faqIndex: 0,
      pattern: /(оплат|плат[её]ж|карт|способ[а-яё]*\s+оплат)/
    },
    {
      topic: "Доставка",
      faqIndex: 0,
      pattern: /(достав|срок|сколько\s+(ид|достав)|когда\s+(прид|достав))/
    }
  ];

  const match = checks.find(({ pattern }) => pattern.test(text));
  return match ? topics[match.topic][match.faqIndex] : null;
}

function isOperatorRequest(message) {
  return /(оператор|человек|сотрудник|консультант|жив(ой|ого)\s+чат|связаться\s+с\s+поддержк)/i
    .test(message);
}

function askQuestion(faq, sourceLabel = "По правилам") {
  addMessage(faq.question, "user");
  addMessage(getFaqAnswer(faq), "bot", { rateable: true, sourceLabel });
  showTopicMenu();
}

function getOrderRequest(message) {
  const normalized = message.toLocaleLowerCase("ru-RU");
  const orderIntent = /заказ/.test(normalized);
  const trackingFaq = findFaq(message);
  if (!orderIntent || (trackingFaq && !/\d/.test(message) && !/(проверь|проверить|статус)/.test(normalized))) {
    return null;
  }

  const match = normalized.match(/заказ(?:а|у|ом|е|ы|ов)?\s*(?:№|номер)?\s*([^\s,.;!?]*)/);
  return { number: match ? match[1].replace(/^№/, "") : "" };
}

function lookupOrder(rawNumber) {
  const number = String(rawNumber || "").trim();
  addMessage(number ? `Статус заказа № ${number}` : "Проверить статус заказа", "user");

  if (!/^\d{4}$/.test(number)) {
    addMessage(
      "Укажите номер учебного заказа из четырёх цифр, например 1001 или 1002. Это демонстрационные данные.",
      "bot"
    );
    showTopicMenu();
    return;
  }

  const order = demoOrders[number];
  if (!order) {
    addMessage(
      `Учебный заказ № ${number} не найден. Проверьте номер: для демонстрации доступны 1001 и 1002.`,
      "bot"
    );
  } else {
    addMessage(
      `Демонстрационный заказ № ${number}: ${order.status}. ${order.delivery}. Данные вымышлены.`,
      "bot"
    );
  }
  showTopicMenu();
}

function scheduleDetails() {
  const selected = scheduleTime.value;
  let date;

  if (selected === "inside") {
    date = new Date("2026-11-23T09:00:00Z");
  } else if (selected === "boundary") {
    date = new Date("2026-11-23T15:00:00Z");
  } else if (selected === "outside") {
    date = new Date("2026-11-23T17:00:00Z");
  } else {
    date = new Date();
  }

  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const weekday = values.weekday.replace(".", "").toLocaleLowerCase("ru-RU");
  const hour = Number(values.hour);
  const isWeekday = ["пн", "вт", "ср", "чт", "пт"].includes(weekday);
  const open = isWeekday && hour >= 9 && hour < 18;
  const time = `${values.hour}:${values.minute}`;

  return {
    open,
    time,
    state: open ? "по учебному графику сейчас рабочее время" : "по учебному графику сейчас нерабочее время"
  };
}

function updateScheduleStatus() {
  const schedule = scheduleDetails();
  document.querySelector("#hours-status").textContent =
    `Контрольное время: ${schedule.time} Europe/Moscow — ${schedule.state}. Это расписание демонстрации, не статус подключения оператора.`;
}

function showOperatorSimulation() {
  const schedule = scheduleDetails();
  addMessage("Оператор", "user");
  addMessage(
    `${schedule.state} (${schedule.time} Europe/Moscow; учебный график: Пн–Пт, 09:00–18:00). ${OPERATOR_MESSAGE}`,
    "bot"
  );
  showTopicMenu();
}

function returnToMenu() {
  addMessage("Главное меню", "user");
  addMessage("Выберите тему или задайте вопрос.", "bot");
  showTopicMenu();
}

function updateFaqMatchStatus() {
  faqMatchStatus.hidden = pendingFaqRequests.size === 0;
  faqMatchStatus.textContent = pendingFaqRequests.size
    ? "Подбираю подходящий ответ…"
    : "";
}

function cancelPendingFaqMatches() {
  conversationGeneration += 1;
  pendingFaqRequests.forEach((controller) => controller.abort());
  pendingFaqRequests.clear();
  updateFaqMatchStatus();
}

async function resolveWithLocalModel(query, generation) {
  if (window.location.protocol === "file:") {
    addMessage(FALLBACK, "bot");
    return;
  }

  const controller = new AbortController();
  pendingFaqRequests.add(controller);
  updateFaqMatchStatus();

  try {
    const response = await fetch("/api/faq-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        faqs: allFaqs().map(({ id, question }) => ({ id, question }))
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`FAQ match service returned ${response.status}`);
    }

    const result = await response.json();
    if (generation !== conversationGeneration) {
      return;
    }

    const faq = typeof result.faqId === "string"
      ? allFaqs().find((item) => item.id === result.faqId)
      : null;
    if (faq) {
      addMessage(getFaqAnswer(faq), "bot", {
        rateable: true,
        sourceLabel: "Подбор с помощью ИИ"
      });
    } else {
      addMessage(FALLBACK, "bot");
    }
  } catch (error) {
    if (generation === conversationGeneration && error.name !== "AbortError") {
      addMessage(FALLBACK, "bot");
    }
  } finally {
    pendingFaqRequests.delete(controller);
    if (generation === conversationGeneration) {
      updateFaqMatchStatus();
    }
  }
}

async function handleUserMessage(rawMessage) {
  const message = rawMessage.trim();
  if (!message) {
    return;
  }

  addMessage(message, "user");

  if (message.toLocaleLowerCase("ru-RU") === "главное меню") {
    addMessage("Выберите тему или задайте вопрос.", "bot");
  } else if (isOperatorRequest(message)) {
    const schedule = scheduleDetails();
    addMessage(
      `${schedule.state} (${schedule.time} Europe/Moscow; учебный график: Пн–Пт, 09:00–18:00). ${OPERATOR_MESSAGE}`,
      "bot"
    );
  } else {
    const orderRequest = getOrderRequest(message);
    if (orderRequest) {
      const number = orderRequest.number;
      if (/^\d+$/.test(number)) {
        const order = demoOrders[number];
        if (number.length !== 4) {
          addMessage("Неверный формат номера учебного заказа: требуется ровно четыре цифры, например 1001.", "bot");
        } else if (!order) {
          addMessage(
            `Учебный заказ № ${number} не найден. Проверьте номер: для демонстрации доступны 1001 и 1002.`,
            "bot"
          );
        } else {
          addMessage(
            `Демонстрационный заказ № ${number}: ${order.status}. ${order.delivery}. Данные вымышлены.`,
            "bot"
          );
        }
      } else {
        addMessage(
          "Неверный формат номера учебного заказа. Укажите ровно четыре цифры, например 1001 или 1002.",
          "bot"
        );
      }
    } else {
      const faq = findFaq(message);
      if (faq) {
        addMessage(getFaqAnswer(faq), "bot", {
          rateable: true,
          sourceLabel: "По правилам"
        });
      } else {
        void resolveWithLocalModel(message, conversationGeneration);
      }
    }
  }

  showTopicMenu();
}

function updateStatistics() {
  const yes = ratings.filter((rating) => rating.vote === "Да").length;
  const no = ratings.filter((rating) => rating.vote === "Нет").length;
  const total = yes + no;
  document.querySelector("#total-votes").textContent = String(total);
  document.querySelector("#yes-votes").textContent = String(yes);
  document.querySelector("#no-votes").textContent = String(no);
  document.querySelector("#useful-percent").textContent =
    `${total ? Math.round((yes / total) * 100) : 0}%`;
  document.querySelector("#stats-empty").hidden = total > 0;
}

function populateFaqEditor() {
  faqSelector.replaceChildren();
  allFaqs().forEach((faq) => {
    const option = document.createElement("option");
    option.value = faq.id;
    option.textContent = faq.question;
    faqSelector.append(option);
  });
  updateFaqEditor();
}

function updateFaqEditor() {
  const faq = allFaqs().find((item) => item.id === faqSelector.value) || allFaqs()[0];
  if (faq) {
    faqAnswer.value = getFaqAnswer(faq);
  }
}

function saveFaqAnswer() {
  const faq = allFaqs().find((item) => item.id === faqSelector.value);
  const answer = faqAnswer.value.trim();
  if (!faq) {
    faqEditorStatus.textContent = "Выберите вопрос FAQ.";
    return;
  }
  if (!answer) {
    faqEditorStatus.textContent = "Ответ не сохранён: введите непустой текст.";
    return;
  }

  faqEdits[faq.id] = answer;
  const saved = saveFaqEdits();
  faqEditorStatus.textContent = saved
    ? "Ответ сохранён локально. Новые ответы чата будут использовать этот текст."
    : "Ответ обновлён только для текущей вкладки. После перезагрузки изменение не сохранится.";
}

function resetConversation(persistGreeting = true) {
  cancelPendingFaqMatches();
  messages = [];
  messagesElement.replaceChildren();
  if (persistGreeting) {
    addMessage(INITIAL_GREETING, "bot");
  } else {
    nextMessageNumber += 1;
    const greeting = {
      id: `${Date.now()}-${nextMessageNumber}`,
      sender: "bot",
      text: INITIAL_GREETING,
      rateable: false
    };
    messages.push(greeting);
    renderMessage(greeting);
  }
  showTopicMenu();
}

function loadSavedData() {
  const savedMessages = readStored(STORAGE_KEYS.history, []);
  messages = Array.isArray(savedMessages)
    ? savedMessages.filter((message) =>
      message
      && typeof message.id === "string"
      && ["bot", "user"].includes(message.sender)
      && typeof message.text === "string"
    ).map((message) => ({
      ...message,
      sourceLabel: ["По правилам", "Подбор с помощью ИИ"].includes(message.sourceLabel)
        ? message.sourceLabel
        : ""
    }))
    : [];

  const savedRatings = readStored(STORAGE_KEYS.ratings, []);
  ratings = Array.isArray(savedRatings)
    ? savedRatings.filter((rating) =>
      rating
      && typeof rating.messageId === "string"
      && ["Да", "Нет"].includes(rating.vote)
    )
    : [];

  const savedFaqEdits = readStored(STORAGE_KEYS.faq, {});
  faqEdits = savedFaqEdits && typeof savedFaqEdits === "object" && !Array.isArray(savedFaqEdits)
    ? Object.fromEntries(
      Object.entries(savedFaqEdits).filter(([id, answer]) =>
        allFaqs().some((faq) => faq.id === id) && typeof answer === "string" && answer.trim()
      )
    )
    : {};

  nextMessageNumber = messages.length;
  if (messages.length === 0) {
    resetConversation();
  } else {
    renderMessages();
    showTopicMenu();
  }
}

function clearAllLocalData() {
  const clearStatus = document.querySelector("#clear-data-status");
  if (storageAvailable) {
    try {
      Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      showStorageWarning(`Не удалось удалить локальные данные: ${error.message}`);
    }
  }

  messages = [];
  ratings = [];
  faqEdits = {};
  resetConversation(false);
  populateFaqEditor();
  updateStatistics();
  clearStatus.textContent = storageAvailable
    ? "Локальные история, оценки и изменения FAQ удалены. Новое приветствие существует только в текущем чате."
    : "История и оценки очищены в текущем чате. Хранилище недоступно: проверить удаление сохранённых данных браузера нельзя.";
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = messageInput.value;
  if (!message.trim()) {
    return;
  }

  handleUserMessage(message);
  messageInput.value = "";
  messageInput.focus();
});

restartButton.addEventListener("click", () => {
  resetConversation();
  messageInput.value = "";
  messageInput.focus();
});
faqSelector.addEventListener("change", updateFaqEditor);
document.querySelector("#save-faq").addEventListener("click", saveFaqAnswer);
scheduleTime.addEventListener("change", updateScheduleStatus);
document.querySelector("#clear-local-data").addEventListener("click", clearAllLocalData);

initializeStorage();
loadSavedData();
populateFaqEditor();
updateStatistics();
updateScheduleStatus();
