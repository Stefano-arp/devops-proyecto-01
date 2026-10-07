const net = require('net');
const { createDatabase, createTcpServer } = require('../index');

let db;
let server;
let port;

beforeAll(async () => {
    const database = createDatabase(':memory:');
    db = database.db;
    await database.ready;
    server = createTcpServer(db);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
});

afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
});

function sendCommand(command) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(port, '127.0.0.1', () => socket.write(command));
        socket.once('data', (data) => { socket.end(); resolve(data.toString().trim()); });
        socket.once('error', reject);
    });
}

test('inserta y consulta items por el protocolo TCP anterior', async () => {
    const inserted = JSON.parse(await sendCommand('{insert:{"name":"Proyector"}}'));
    expect(inserted.data[0].name).toBe('Proyector');
    const fetched = JSON.parse(await sendCommand(`{get:${inserted.data[0].id}}`));
    expect(fetched.data[0]).toMatchObject(inserted.data[0]);
});

test('rechaza JSON inválido, falta de nombre y comandos desconocidos', async () => {
    expect(await sendCommand('{insert:{name:sincomillas}}')).toContain('Formato JSON invalido');
    expect(await sendCommand('{insert:{"otro":"valor"}}')).toContain('debe contener');
    expect(await sendCommand('hola')).toContain('Comando no valido');
});

test('GET TCP de elemento inexistente responde con lista vacía', async () => {
    const response = JSON.parse(await sendCommand('{get:99999}'));
    expect(response.data).toEqual([]);
});
