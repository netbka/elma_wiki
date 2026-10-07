import {
  fieldGuideFixture, createFieldGuideModel, renderFieldGuide
} from '../../web/public-field-guide.mjs';

export default {
  id: 'public-field-guide',
  title: 'Система/Публичный поиск поля',
  parameters: { layout: 'fullscreen' }
};

const story = fixture => ({
  render: () => {
    const main = document.createElement('main');
    main.innerHTML = renderFieldGuide(createFieldGuideModel(fixture()));
    return main;
  }
});

export const Ready = { ...story(fieldGuideFixture), name: 'От задачи к полю' };
export const Unavailable = {
  ...story(() => []), name: 'Данных недостаточно'
};
export const Ambiguous = {
  ...story(() => {
    const records = fieldGuideFixture();
    records[0].document.fields.push(structuredClone(records[0].document.fields[0]));
    return records;
  }),
  name: 'Повторяющийся код'
};
