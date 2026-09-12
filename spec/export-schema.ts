import { mkdir, writeFile } from 'node:fs/promises';
import { catalogSchema, enhancementSchema, manifestSchema, shardSchema } from './schema.js';
import { createFixtureCatalog } from './fixtures/catalog.js';

await mkdir(new URL('./schema/', import.meta.url), { recursive: true });
for (const [name, schema] of Object.entries({ catalog: catalogSchema, manifest: manifestSchema, shard: shardSchema, enhancement: enhancementSchema })) {
  await writeFile(new URL(`./schema/${name}.schema.json`, import.meta.url), JSON.stringify(schema, null, 2) + '\n');
}
await writeFile(new URL('./fixtures/catalog.json', import.meta.url), JSON.stringify(createFixtureCatalog(), null, 2) + '\n');
