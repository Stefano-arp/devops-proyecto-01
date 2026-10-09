const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resources, createApp, createDatabase } = require('../index');

let db;
let app;

beforeEach(async () => {
    const database = createDatabase(':memory:');
    db = database.db;
    await database.ready;
    app = createApp(db);
});

afterEach((done) => { db.close(done); });

async function references() {
    const item = await request(app).post('/api/items').send({ name: 'Proyector' });
    const user = await request(app).post('/api/users').send({ username: 'ana' });
    return { item_id: item.body.data[0].id, user_id: user.body.data[0].id };
}

const samples = {
    items: { name: 'Monitor' },
    users: { username: 'alicia' },
    categories: { name: 'Oficina', description: 'Equipos de oficina' },
    locations: { name: 'Edificio A', address: 'Segundo piso' },
    departments: { name: 'TI', description: 'Soporte técnico' },
    suppliers: { name: 'Proveedor A', email: 'contacto@ejemplo.test' },
    brands: { name: 'Marca A' },
    units: { name: 'Pieza', symbol: 'pz' },
    projects: { name: 'Laboratorio', description: 'Ampliación' },
    loans: { due_date: '2026-11-10' },
    reservations: { reserved_for: '2026-11-11' },
    'maintenance-records': { description: 'Limpieza', performed_at: '2026-11-12' }
};

for (const resource of resources) {
    test(`CRUD real para las cinco rutas /api/${resource.route}`, async () => {
        const route = `/api/${resource.route}`;
        const body = { ...samples[resource.route] };
        if (['loans', 'reservations', 'maintenance-records'].includes(resource.route)) {
            const refs = await references();
            body.item_id = refs.item_id;
            if (resource.route !== 'maintenance-records') body.user_id = refs.user_id;
        }

        const empty = await request(app).get(route);
        expect(empty.status).toBe(200);
        expect(empty.body.data).toEqual([]);

        const created = await request(app).post(route).send(body);
        expect(created.status).toBe(201);
        expect(created.body.statusCode).toBe(201);
        expect(created.body.data[0]).toMatchObject(body);
        const id = created.body.data[0].id;

        const list = await request(app).get(route);
        expect(list.body.data).toHaveLength(1);
        const one = await request(app).get(`${route}/${id}`);
        expect(one.body.data[0]).toMatchObject({ id, ...body });

        const update = { ...body };
        if (update.name) update.name = `${update.name} nuevo`;
        else if (update.username) update.username = 'beatriz';
        else if (update.description) update.description = 'Revisado';
        else if (update.due_date) update.due_date = '2026-12-01';
        else update.reserved_for = '2026-12-01';
        const updated = await request(app).put(`${route}/${id}`).send(update);
        expect(updated.status).toBe(200);
        expect(updated.body.data[0]).toMatchObject({ id, ...update });

        const deleted = await request(app).delete(`${route}/${id}`);
        expect(deleted.status).toBe(200);
        expect((await request(app).get(`${route}/${id}`)).status).toBe(404);
    });
}

test('registra 60 endpoints CRUD distintos y el health check', () => {
    const routes = app._router.stack
        .filter((layer) => layer.route)
        .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
    expect(routes).toHaveLength(61);
    expect(new Set(routes).size).toBe(61);
    expect(routes).toContain('GET /api/health');

});









test('health devuelve 200 con version y base de datos accesible', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(201);
    expect(res.body.data[0]).toMatchObject({ message: 'API operativa al 100', version: 'local' });
});









test('valida campos obligatorios, vacíos, adicionales y tipos', async () => {
    for (const body of [{}, { name: '' }, { name: null }, { name: 34 }, { name: 'ok', admin: true }, []]) {
        expect((await request(app).post('/api/items').send(body)).status).toBe(400);
    }
    expect((await request(app).post('/api/suppliers').send({ name: 'A', email: '' })).status).toBe(400);
    expect((await request(app).post('/api/items').send({ name: 'x'.repeat(201) })).status).toBe(400);
});

test('valida fechas reales, enteros positivos y claves foráneas', async () => {
    for (const due_date of ['2026-02-30', 'ayer', '2026-13-01']) {
        expect((await request(app).post('/api/loans').send({ item_id: 1, user_id: 1, due_date })).status).toBe(400);
    }
    expect((await request(app).post('/api/loans').send({ item_id: -1, user_id: 1, due_date: '2026-11-10' })).status).toBe(400);
    expect((await request(app).post('/api/loans').send({ item_id: 1, user_id: 1, due_date: '2026-11-10' })).status).toBe(409);
});

test('evita borrar items referenciados por préstamos', async () => {
    const refs = await references();
    await request(app).post('/api/loans').send({ ...refs, due_date: '2026-11-10' });
    expect((await request(app).delete(`/api/items/${refs.item_id}`)).status).toBe(409);
    expect((await request(app).get(`/api/items/${refs.item_id}`)).status).toBe(200);
});

test('IDs inexistentes y no numéricos devuelven 404 y 400 respectivamente', async () => {
    expect((await request(app).get('/api/items/999')).status).toBe(404);
    expect((await request(app).put('/api/items/999').send({ name: 'X' })).status).toBe(404);
    expect((await request(app).delete('/api/items/999')).status).toBe(404);
    for (const id of ['abc', '0', '9999999999999999999']) {
        expect((await request(app).get(`/api/items/${id}`)).status).toBe(400);
        expect((await request(app).put(`/api/items/${id}`).send({ name: 'X' })).status).toBe(400);
        expect((await request(app).delete(`/api/items/${id}`)).status).toBe(400);
    }
});

test('PUT con cuerpo vacío o campos incorrectos no altera los datos', async () => {
    const created = await request(app).post('/api/items').send({ name: 'Original' });
    const url = `/api/items/${created.body.data[0].id}`;
    expect((await request(app).put(url).send({})).status).toBe(400);
    expect((await request(app).put(url).send({ name: null })).status).toBe(400);
    expect((await request(app).get(url)).body.data[0].name).toBe('Original');
});

test('permite omitir campos opcionales sin afectar el resto en PUT', async () => {
    const created = await request(app).post('/api/categories').send({ name: 'Antes', description: 'Viejo' });
    const url = `/api/categories/${created.body.data[0].id}`;
    const updated = await request(app).put(url).send({ name: 'Después' });
    expect(updated.status).toBe(200);
    expect(updated.body.data[0]).toMatchObject({ name: 'Después', description: 'Viejo' });
});

test('JSON inválido y rutas inexistentes se rechazan', async () => {
    const bad = await request(app).post('/api/items').set('Content-Type', 'application/json').send('{mal: json');
    expect(bad.status).toBe(400);
    expect(bad.body.statusCode).toBe(400);
    expect((await request(app).get('/api/noexiste')).status).toBe(404);
    expect((await request(app).delete('/api/db/clear')).status).toBe(404);
});

test('la base SQLite sobrevive al cierre y reapertura del servicio', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devops-api-'));
    const filename = path.join(directory, 'database.sqlite');
    try {
        const first = createDatabase(filename);
        await first.ready;
        expect((await request(createApp(first.db)).post('/api/items').send({ name: 'Persistente' })).status).toBe(201);
        await new Promise((resolve, reject) => first.db.close((error) => error ? reject(error) : resolve()));
        const reopened = createDatabase(filename);
        await reopened.ready;
        const response = await request(createApp(reopened.db)).get('/api/items');
        expect(response.body.data[0].name).toBe('Persistente');
        await new Promise((resolve, reject) => reopened.db.close((error) => error ? reject(error) : resolve()));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
