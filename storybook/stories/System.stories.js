import { story, catalog } from './helpers.js';
export default { title: 'Система', id: 'system' };
export const WholeSystem = { name: 'Вся картина', render: catalog };
export const Upload = { name: 'Файл → карта → исследование', ...story('upload') };
export const Partial = { name: 'Неполный разбор и восстановление', ...story('upload', 'partial') };
