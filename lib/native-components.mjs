// Manifest identities and declared bytes are comparison evidence. These profiles
// do not interpret arbitrary service internals or make their source executable.
const profiles = new Map(Object.entries({
  pages: ['page'], permissionsSettings: ['pagePermissions', 'permissionSettings', 'applicationDirectoriesPermissions'],
  groups: ['group'], serials: ['serial'], templates: ['doctemplate'],
  extensions: ['extension', 'scripts', 'scripts_runtime'], localizer: ['localization'],
  crm: ['element_activity_settings', 'warm_up_stages_settings'], 'event-bus': ['subscription']
}));
const emptyServices = new Set(['babysitter','contractor','docflow','exchangeSrv','external_applications','indicators','nomenclature','oauth2','portal','products','projects','reporter','telephony','web-forms']);
export const nativeService = service => profiles.has(service) || emptyServices.has(service);
export const nativeRecord = (service, record) => profiles.get(service)?.includes(record?.kind) === true;
export const resourceContainer = (service, record, raw) => service === 'localizer' && record?.kind === 'localization' && raw === null && Array.isArray(record.resources) && record.resources.length > 0;
export function componentIdentity(entity) {
  if (entity.service === 'localizer' && entity.kind === 'localization' && entity.code === '' && typeof entity.namespace === 'string' && entity.namespace) return [entity.service, entity.namespace, entity.kind, ''];
  const parts = [entity.service, entity.namespace, entity.code];
  if (!parts.every(part => typeof part === 'string' && part)) return null;
  // Native records of these services have distinct kinds under one namespace/code.
  // Keep the existing 3-part identity for previously supported ordinary objects.
  if (['permissionsSettings','extensions'].includes(entity.service) || entity.service === 'processor' && ['template','custom_activity','custom_activity_group'].includes(entity.kind)) parts.splice(2, 0, entity.kind);
  return parts;
}
export function resourcePaths(service, record) {
  if (record.resources == null) return [];
  if (!Array.isArray(record.resources)) throw Error('unknown-resource-schema');
  return record.resources.map(row => {
    if (!row || typeof row.path !== 'string' || !row.path) throw Error('unknown-resource-schema');
    const relative = row.path.replaceAll('\\','/').replace(/^\/+/, '');
    if (relative.split('/').some(part => !part || ['.','..'].includes(part) || part.includes(':'))) throw Error('unsafe-resource-path');
    return service + '/' + relative;
  });
}
