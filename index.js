const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const net = require('net');

// Las tablas items y users conservan el esquema de la práctica anterior.
const resources = [
    { route: 'items', table: 'items', fields: { name: 'text' } },
    { route: 'users', table: 'users', fields: { username: 'text' } },
    { route: 'categories', table: 'categories', fields: { name: 'text', description: 'optionalText' } },
    { route: 'locations', table: 'locations', fields: { name: 'text', address: 'optionalText' } },
    { route: 'departments', table: 'departments', fields: { name: 'text', description: 'optionalText' } },
    { route: 'suppliers', table: 'suppliers', fields: { name: 'text', email: 'optionalText' } },
    { route: 'brands', table: 'brands', fields: { name: 'text' } },
    { route: 'units', table: 'units', fields: { name: 'text', symbol: 'optionalText' } },
    { route: 'projects', table: 'projects', fields: { name: 'text', description: 'optionalText' } },
    { route: 'loans', table: 'loans', fields: { item_id: 'itemRef', user_id: 'userRef', due_date: 'date' } },
    { route: 'reservations', table: 'reservations', fields: { item_id: 'itemRef', user_id: 'userRef', reserved_for: 'date' } },
    { route: 'maintenance-records', table: 'maintenance_records', fields: { item_id: 'itemRef', description: 'text', performed_at: 'date' } }
];

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (error) {
            if (error) reject(error);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
    });
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    });
}

function createDatabase(filename) {
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
    const db = new sqlite3.Database(filename);
    const ready = (async () => {
        await run(db, 'PRAGMA foreign_keys = ON');
        await run(db, 'PRAGMA busy_timeout = 5000');
        await get(db, 'PRAGMA journal_mode = WAL');
        await run(db, 'CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
        await run(db, 'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT)');
        for (const resource of resources.slice(2)) {
            const columns = Object.entries(resource.fields).map(([field, kind]) => {
                if (kind === 'itemRef') return `${field} INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT`;
                if (kind === 'userRef') return `${field} INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT`;
                return `${field} TEXT${kind === 'optionalText' ? '' : ' NOT NULL'}`;
            });
            await run(db, `CREATE TABLE IF NOT EXISTS ${resource.table} (id INTEGER PRIMARY KEY AUTOINCREMENT, ${columns.join(', ')})`);
        }
    })();
    return { db, ready };
}

function parseId(value) {
    if (!/^[1-9]\d*$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
}

function validateBody(body, resource) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Se requiere un objeto JSON' };
    const fields = resource.fields;
    const unknown = Object.keys(body).find((key) => !Object.hasOwn(fields, key));
    if (unknown) return { error: `Campo no permitido: ${unknown}` };
    const values = {};
    for (const [field, kind] of Object.entries(fields)) {
        const value = body[field];
        if (kind === 'optionalText' && value === undefined) continue;
        if (kind === 'itemRef' || kind === 'userRef') {
            if (!Number.isSafeInteger(value) || value <= 0) return { error: `${field} debe ser un entero positivo` };
            values[field] = value;
        } else if (typeof value !== 'string' || !value.trim() || value.length > 200) {
            return { error: `${field} debe ser texto no vacío de hasta 200 caracteres` };
        } else if (kind === 'date') {
            const date = new Date(`${value}T00:00:00Z`);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
                return { error: `${field} debe tener fecha válida YYYY-MM-DD` };
            }
            values[field] = value;
        } else {
            values[field] = value.trim();
        }
    }
    return { values };
}

function reply(res, status, data) {
    return res.status(status).json({ statusCode: status, data });
}

function handleError(res, error) {
    if (error.code === 'SQLITE_CONSTRAINT') return reply(res, 409, [{ error: 'Conflicto de integridad: compruebe las referencias o dependencias' }]);
    console.error('Error de base de datos:', error);
    return reply(res, 500, [{ error: 'Error interno del servidor' }]);
}

function createApp(db) {
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json());

    app.get('/api/health', async (req, res) => {
        try {
            await get(db, 'SELECT 1 AS ok');
            return reply(res, 200, [{ message: 'API operativa', version: process.env.APP_VERSION || 'local' }]);
        } catch (error) {
            return reply(res, 503, [{ error: 'Base de datos no disponible' }]);
        }
    });

    for (const resource of resources) {
        const base = `/api/${resource.route}`;
        app.get(base, async (req, res) => {
            try {
                return reply(res, 200, await all(db, `SELECT * FROM ${resource.table} ORDER BY id`));
            } catch (error) { return handleError(res, error); }
        });
        app.get(`${base}/:id`, async (req, res) => {
            const id = parseId(req.params.id);
            if (!id) return reply(res, 400, [{ error: 'ID inválido' }]);
            try {
                const row = await get(db, `SELECT * FROM ${resource.table} WHERE id = ?`, [id]);
                return row ? reply(res, 200, [row]) : reply(res, 404, [{ error: 'Recurso no encontrado' }]);
            } catch (error) { return handleError(res, error); }
        });
        app.post(base, async (req, res) => {
            const checked = validateBody(req.body, resource);
            if (checked.error) return reply(res, 400, [{ error: checked.error }]);
            const keys = Object.keys(checked.values);
            try {
                const result = await run(db, `INSERT INTO ${resource.table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, Object.values(checked.values));
                return reply(res, 201, [await get(db, `SELECT * FROM ${resource.table} WHERE id = ?`, [result.lastID])]);
            } catch (error) { return handleError(res, error); }
        });
        app.put(`${base}/:id`, async (req, res) => {
            const id = parseId(req.params.id);
            if (!id) return reply(res, 400, [{ error: 'ID inválido' }]);
            const checked = validateBody(req.body, resource);
            if (checked.error) return reply(res, 400, [{ error: checked.error }]);
            const keys = Object.keys(checked.values);
            if (!keys.length) return reply(res, 400, [{ error: 'No hay campos para actualizar' }]);
            try {
                const result = await run(db, `UPDATE ${resource.table} SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`, [...Object.values(checked.values), id]);
                if (!result.changes) return reply(res, 404, [{ error: 'Recurso no encontrado' }]);
                return reply(res, 200, [await get(db, `SELECT * FROM ${resource.table} WHERE id = ?`, [id])]);
            } catch (error) { return handleError(res, error); }
        });
        app.delete(`${base}/:id`, async (req, res) => {
            const id = parseId(req.params.id);
            if (!id) return reply(res, 400, [{ error: 'ID inválido' }]);
            try {
                const result = await run(db, `DELETE FROM ${resource.table} WHERE id = ?`, [id]);
                return result.changes ? reply(res, 200, []) : reply(res, 404, [{ error: 'Recurso no encontrado' }]);
            } catch (error) { return handleError(res, error); }
        });
    }

    app.use((error, req, res, next) => {
        if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
            return reply(res, 400, [{ error: 'JSON inválido' }]);
        }
        console.error('Error HTTP:', error);
        return reply(res, 500, [{ error: 'Error interno del servidor' }]);
    });
    return app;
}

// Compatibilidad con la práctica anterior. TCP es opcional y nunca se publica en EC2.
function createTcpServer(db) {
    return net.createServer((socket) => {
        socket.on('data', async (data) => {
            const command = data.toString().trim();
            const insert = command.match(/^{insert:(.+)}$/);
            if (insert) {
                let element;
                try { element = JSON.parse(insert[1]); } catch (_) {
                    socket.write('Error: Formato JSON invalido\n');
                    return;
                }
                if (!element || typeof element.name !== 'string' || !element.name.trim()) {
                    socket.write('Error: JSON debe contener {"name":"valor"}\n');
                    return;
                }
                try {
                    const result = await run(db, 'INSERT INTO items (name) VALUES (?)', [element.name.trim()]);
                    socket.write(JSON.stringify({ statusCode: 200, data: [{ id: result.lastID, name: element.name.trim() }] }) + '\n');
                } catch (_) { socket.write('Error: No se pudo guardar el item\n'); }
                return;
            }
            const match = command.match(/^{get:([1-9]\d*)}$/);
            if (match) {
                try {
                    const rows = await all(db, 'SELECT * FROM items WHERE id = ?', [match[1]]);
                    socket.write(JSON.stringify({ statusCode: 200, data: rows }) + '\n');
                } catch (_) { socket.write('Error: No se pudo consultar el item\n'); }
                return;
            }
            socket.write('Comando no valido. Ej: {insert:{"name":"Prueba TCP"}} o {get:1}\n');
        });
    });
}

async function start() {
    const filename = process.env.DB_PATH || path.join(process.cwd(), 'data', 'database.sqlite');
    const { db, ready } = createDatabase(filename);
    await ready;
    const port = Number(process.env.PORT || 3000);
    const httpServer = createApp(db).listen(port, '0.0.0.0', () => console.log(`API escuchando en ${port}`));
    const tcpServer = process.env.ENABLE_TCP === 'true' ? createTcpServer(db) : null;
    if (tcpServer) tcpServer.listen(Number(process.env.TCP_PORT || 6061), '127.0.0.1');
    process.on('SIGTERM', () => {
        httpServer.close(() => {
            if (tcpServer) tcpServer.close(() => db.close());
            else db.close();
        });
    });
}

if (require.main === module) start().catch((error) => { console.error('No se pudo iniciar la API:', error); process.exitCode = 1; });

module.exports = { resources, createDatabase, createApp, createTcpServer };
