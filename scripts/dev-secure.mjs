process.env.RING_HTTPS = '1';
const { createServer } = await import('vite');
const server = await createServer();
await server.listen();
server.printUrls();
