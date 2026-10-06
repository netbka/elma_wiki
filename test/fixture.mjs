import yazl from 'yazl';
export async function zip(entries) {
  const archive = new yazl.ZipFile();
  for (const [name, value] of entries) archive.addBuffer(Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), name);
  const chunks = []; archive.outputStream.on('data', chunk => chunks.push(chunk));
  const done = new Promise((resolve, reject) => { archive.outputStream.on('end', () => resolve(Buffer.concat(chunks))); archive.outputStream.on('error', reject); });
  archive.end(); return done;
}
export async function fixture({ code = 'example_solution', target, fieldCode = 'title', secret = 'TEST_SENTINEL_VALUE_NOT_A_REAL_SECRET', nested = true } = {}) {
  const pkg = { code, title: 'Синтетическая конфигурация', type: 'SOLUTION', ...(target ? { dependencies: { widgets: [{ code: 'provider', data: { namespace: 'example_module.records', code: target } }] } } : {}) };
  const service = [
    ['manifest.json', { entities: [{ code: 'form', namespace: 'example_module.records', name: 'Учебная форма', kind: 'WIDGET', path: 'form.json' }] }],
    ['form.json', { dataNamespace: 'example_module', dataCode: 'records', descriptor: {
      fields: [{ code: fieldCode, type: 'STRING', view: { name: 'Заголовок' }, defaultValue: secret }],
      clientScripts: `function onOpen() { ViewContext.data.title; Server.rpc.check(); const ignored = '${secret} ViewContext.data.TEST_LITERAL'; } // function TEST_COMMENT() { Global.data.TEST_COMMENT; }`,
      serverScripts: 'async function check() { return Context.data.title; }', template: { values: { systemFunctions: { onInit: { name: 'onOpen', type: 'client' } } } }
    }, runtime: secret, password: secret }]
  ];
  return zip([['package.json', pkg], ...(nested ? [['widgets.zip', await zip(service)]] : service.map(([name, value]) => ['widgets/' + name, value]))]);
}
