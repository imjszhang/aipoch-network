import { loadCatalog } from './index.mjs';

const usage = 'Usage: node consumer/cli.mjs <manifest-url> [--query text | --resource resource:id]';
async function main() {
  const [url, mode, value, ...extra] = process.argv.slice(2);
  if (!url || extra.length || (mode && !['--query', '--resource'].includes(mode)) || (mode && value === undefined) || (!mode && value)) throw new Error(usage);
  const catalog = await loadCatalog(url);
  const output = mode === '--resource' ? catalog.locateResource(value) : {
    contract_version: catalog.manifest.contract_version,
    snapshot_id: catalog.manifest.snapshot_id,
    generated_at: catalog.manifest.generated_at,
    counts: Object.fromEntries(Object.entries(catalog.collections).map(([name, values]) => [name, values.length])),
    resources: catalog.listResources(value ?? '').map(item => ({ id: item.id, title: item.title, resource_type: item.resource_type, status: item.status })),
  };
  console.log(JSON.stringify(output, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Catalog consumer failed'); process.exitCode = 1; });
