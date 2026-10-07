import { renderLogin } from '../../web/login-view.js';
export default { id: 'login', title: 'Система/Вход через бота', parameters: { layout: 'fullscreen' } };
const story = model => ({ render: () => { const main = document.createElement('main'); renderLogin(main, model); return main; } });
export const Ready = story({ vkBotUrl: 'https://teams.vk.com/profile/synthetic_login_bot' });
export const Expired = story({ vkBotUrl: 'https://teams.vk.com/profile/synthetic_login_bot', expired: true });
export const Unconfigured = story({ vkBotUrl: null });
