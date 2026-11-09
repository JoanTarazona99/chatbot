"use strict";

const INITIAL_GREETING =
  "Здравствуйте! Я учебный чат-бот поддержки. Выберите тему или задайте вопрос.";
const FALLBACK =
  "Пока нет подходящего ответа. Выберите тему или запросите оператора.";
const OPERATOR_MESSAGE =
  "Это демонстрационная функция. В реальном продукте здесь создавался бы запрос оператору. Подключение к реальному оператору не выполняется.";

const topics = {
  "Оплата": [
    {
      question: "Какие способы оплаты доступны?",
      answer: "В нашем учебном магазине предусмотрена оплата банковской картой."
    }
  ],
  "Доставка": [
    {
      question: "Какие сроки доставки?",
      answer: "Примерный срок доставки — 3–5 рабочих дней. Точный срок уточняется при оформлении заказа."
    },
    {
      question: "Как отследить заказ?",
      answer: "В учебном сценарии статус заказа можно посмотреть в разделе “Мои заказы”."
    }
  ],
  "Аккаунт": [
    {
      question: "Как восстановить пароль?",
      answer: "На странице входа нажмите “Забыли пароль?” и следуйте инструкциям."
    }
  ]
};

const messagesElement = document.querySelector("#messages");
const quickActionsElement = document.querySelector("#quick-actions");
const chatForm = document.querySelector("#chat-form");
const messageInput = document.querySelector("#message-input");
const restartButton = document.querySelector("#restart-button");

function scrollToLatestMessage() {
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

function addMessage(text, sender, options = {}) {
  const row = document.createElement("article");
  row.className = `message-row ${sender}`;

  const senderLabel = document.createElement("span");
  senderLabel.className = "message-sender";
  senderLabel.textContent = sender === "bot" ? "Помощник" : "Вы";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = text;
  row.append(senderLabel, bubble);

  if (options.rateable) {
    addFeedbackControls(row);
  }

  messagesElement.append(row);
  scrollToLatestMessage();
  return row;
}

function addFeedbackControls(messageRow) {
  const feedback = document.createElement("div");
  feedback.className = "feedback";

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
      if (button.disabled) {
        return;
      }

      feedback.querySelectorAll("button").forEach((item) => {
        item.disabled = true;
        item.hidden = true;
      });

      const result = document.createElement("span");
      result.className = "feedback-result";
      result.textContent = choice === "Да"
        ? "Спасибо за оценку!"
        : "Спасибо за обратную связь. Вы можете выбрать другую тему или запросить оператора.";
      feedback.append(result);
      scrollToLatestMessage();
    });
    feedback.append(button);
  });

  messageRow.append(feedback);
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
    createQuickButton("Оператор", showOperatorSimulation)
  );
}

function showTopicQuestions(topic) {
  quickActionsElement.replaceChildren();
  topics[topic].forEach(({ question }) => {
    quickActionsElement.append(
      createQuickButton(question, () => askQuestion(question))
    );
  });
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

  return checks.find(({ pattern }) => pattern.test(text));
}

function isOperatorRequest(message) {
  return /(оператор|человек|сотрудник|консультант|жив(ой|ого)\s+чат|связаться\s+с\s+поддержк)/i
    .test(message);
}

function askQuestion(question) {
  const faq = Object.values(topics)
    .flat()
    .find((item) => item.question === question);

  if (!faq) {
    addMessage(FALLBACK, "bot");
    showTopicMenu();
    return;
  }

  addMessage(question, "user");
  addMessage(faq.answer, "bot", { rateable: true });
  showTopicMenu();
}

function showOperatorSimulation() {
  addMessage("Оператор", "user");
  addMessage(OPERATOR_MESSAGE, "bot");
  showTopicMenu();
}

function returnToMenu() {
  addMessage("Главное меню", "user");
  addMessage("Выберите тему или задайте вопрос.", "bot");
  showTopicMenu();
}

function handleUserMessage(rawMessage) {
  const message = rawMessage.trim();
  if (!message) {
    return;
  }

  addMessage(message, "user");

  if (isOperatorRequest(message)) {
    addMessage(OPERATOR_MESSAGE, "bot");
  } else {
    const faqMatch = findFaq(message);
    if (faqMatch) {
      addMessage(topics[faqMatch.topic][faqMatch.faqIndex].answer, "bot", {
        rateable: true
      });
    } else {
      addMessage(FALLBACK, "bot");
    }
  }

  showTopicMenu();
}

function resetChat() {
  messagesElement.replaceChildren();
  addMessage(INITIAL_GREETING, "bot");
  showTopicMenu();
  messageInput.value = "";
  messageInput.focus();
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

restartButton.addEventListener("click", resetChat);

resetChat();
