import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
const root = resolve(option('--dir','dist'));
const port = Number(option('--port','4173'));
const base = option('--base','/');
const types: Record<string,string> = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png' };
const server = createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (!pathname.startsWith(base) || pathname.includes('\0')) throw new Error('Not found');
    let file = resolve(root, pathname.slice(base.length));
    if (file !== root && !file.startsWith(root + sep)) throw new Error('Not found');
    const metadata = await stat(file);
    if (metadata.isDirectory()) {
      if (!pathname.endsWith('/')) { res.writeHead(301,{Location:`${pathname}/${new URL(req.url ?? '/', 'http://localhost').search}`}); res.end(); return; }
      file = resolve(file,'index.html');
    }
    const content = await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)] ?? 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});
    res.end(await readFile(resolve(root,'404.html')).catch(() => 'Not found'));
  }
});
server.listen(port,'127.0.0.1',() => console.log(`Static preview: http://127.0.0.1:${port}${base}`));
process.on('SIGTERM',() => server.close());
process.on('SIGINT',() => server.close());
