import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import yazl from 'yazl';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const extension = path.join(root, 'extensions/e365-workbench');
const pkg = JSON.parse(await fs.readFile(path.join(extension, 'package.json'), 'utf8'));
const output = path.join(root, '.local', `${pkg.name}-${pkg.version}.vsix`);
await fs.mkdir(path.dirname(output), { recursive: true });
const zip = new yazl.ZipFile();
zip.addBuffer(Buffer.from(`<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011"><Metadata><Identity Language="ru-RU" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}"/><DisplayName>${pkg.displayName}</DisplayName><Description xml:space="preserve">${pkg.description}</Description><Tags>ELMA365,JSON</Tags><Categories>Other</Categories><GalleryFlags>Preview</GalleryFlags><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="${pkg.engines.vscode}"/><Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/><Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/></Assets></PackageManifest>`), 'extension.vsixmanifest');
zip.addBuffer(Buffer.from('<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="mjs" ContentType="application/javascript"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>'), '[Content_Types].xml');
for (const name of ['package.json', 'extension.cjs', 'core.mjs', 'README.md']) zip.addBuffer(await fs.readFile(path.join(extension, name)), `extension/${name}`);
const out = createWriteStream(output);
await new Promise((resolve, reject) => { out.on('close', resolve); out.on('error', reject); zip.outputStream.on('error', reject); zip.outputStream.pipe(out); zip.end(); });
console.log(output);
