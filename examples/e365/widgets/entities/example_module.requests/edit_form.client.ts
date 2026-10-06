// Учебная функция; привязка события и SDK проверяются отдельно.
async function onOpen(): Promise<void> {
  ViewContext.data.ready = Boolean(Context.data.title);
}
