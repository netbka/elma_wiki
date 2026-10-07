export function renderLogin(root, { vkBotUrl, expired = false }) {
  root.replaceChildren();
  const intro = document.createElement('p'); intro.className = 'lead';
  intro.textContent = 'Откройте бота в VK Teams и отправьте любое сообщение. Бот пришлёт ссылку: нажмите её, и вы в Wiki. Ссылка и вход действуют 7 дней.';
  root.append(intro);
  if (expired) {
    const note = document.createElement('p'); note.setAttribute('role', 'status');
    note.textContent = 'Ссылка недействительна или срок её действия истёк. Откройте бота и получите новую.';
    root.append(note);
  }
  if (vkBotUrl && /^https:\/\/teams\.vk\.com\/profile\/[A-Za-z0-9_%.-]+$/.test(vkBotUrl)) {
    const button = document.createElement('a'); button.className = 'button'; button.id = 'vk-bot-link';
    button.href = vkBotUrl; button.textContent = 'Открыть бота в VK Teams';
    root.append(button);
  } else {
    const note = document.createElement('p'); note.setAttribute('role', 'status');
    note.textContent = 'Бот входа ещё не настроен. Обратитесь к администратору.';
    root.append(note);
  }
}
