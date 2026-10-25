// Testler için en küçük MCP sunucusu (stdio, satır başına bir JSON-RPC mesajı)
const readline = require('readline');
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return; // bildirim
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mini', version: '1.0.0' } } });
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: [
      { name: 'topla', description: 'İki sayıyı toplar', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
      { name: 'patla', description: 'Hep hata verir', inputSchema: { type: 'object', properties: {} } },
    ] } });
  } else if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params;
    if (name === 'topla') send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `Sonuç: ${args.a + args.b} (${process.env.MINI_ETIKET ?? 'etiketsiz'})` }] } });
    else send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'bir şeyler ters gitti' }], isError: true } });
  } else {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Bilinmeyen yöntem: ${msg.method}` } });
  }
});
