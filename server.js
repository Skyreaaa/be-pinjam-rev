// File: server.js (FULL KODE SIAP PAKAI)

const express = require('express');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const fs = require('fs');
const cors = require('cors');
const path = require('path'); // WAJIB untuk path static files
const { ensureSeedData } = require('./utils/seeder');

// --- 1. Import Routes Tambahan ---
const adminRoutes = require('./routes/adminRoutes'); // WAJIB: Pastikan import ini ada
const authRoutes = require('./routes/auth'); 
const loanRoutes = require('./routes/loanRoutes'); 
const bookRoutes = require('./routes/bookRoutes'); 
const profileRoutes = require('./routes/profile'); 

// --- Load .env explicitly (resolve path) ---
const envPathCandidates = [
    path.join(__dirname, '.env'), // preferred: be-pinjam-master/.env
    path.join(process.cwd(), '.env'),
];
let loadedEnvPath = null;
for (const p of envPathCandidates) {
    if (fs.existsSync(p)) {
        const result = dotenv.config({ path: p });
        if (!result.error) {
            loadedEnvPath = p;
            break;
        }
    }
}
if (!loadedEnvPath) {
    console.warn('[ENV] Tidak menemukan file .env di kandidat path:', envPathCandidates);
} else {
    console.log('[ENV] Loaded from:', loadedEnvPath);
}

// --- Advanced Fallback: handle possible UTF-16 (null byte) or weird encoding / BOM characters ---
function robustParseEnv(filePath) {
    const parsed = {};
    let buffer;
    try {
        buffer = fs.readFileSync(filePath);
    } catch (e) {
        console.error('[ENV Fallback] Tidak bisa baca file:', e.message);
        return parsed;
    }
    let content;
    const hasNull = buffer.includes(0x00);
    if (hasNull) {
        // Coba decode sebagai UTF-16 LE
        try {
            content = buffer.toString('utf16le');
            console.warn('[ENV Fallback] Mendeteksi null bytes -> mencoba decode utf16le');
        } catch {
            content = buffer.toString('utf8');
        }
    } else {
        content = buffer.toString('utf8');
    }
    // Normalisasi: hilangkan karakter BOM / zero-width
    content = content.replace(/\uFEFF/g, '').replace(/[\u200B-\u200D\u2060\u00A0]/g, '');
    const lines = content.split(/\r?\n/);
    for (let rawLine of lines) {
        if (!rawLine) continue;
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) continue;
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if (!key.match(/^[A-Za-z_][A-Za-z0-9_]*$/)) continue; // skip invalid keys
        val = val.replace(/^['"`](.*)['"`]$/,'$1');
        if (!(key in process.env) || !process.env[key]) {
            process.env[key] = val;
            parsed[key] = val;
        }
    }
    if (Object.keys(parsed).length === 0) {
        console.warn('[ENV Fallback] Tidak ada key baru ter-parse (mungkin semua masih gagal).');
    }
    return parsed;
}

// Detect keys that might have hidden characters (e.g., BOM or zero-width) by listing all keys containing 'DB' or 'JWT'
const suspiciousKeys = Object.keys(process.env).filter(k => /(DB_|JWT|AUTH_DEBUG)/i.test(k));
if (suspiciousKeys.length) {
    console.log('[ENV] Keys terdeteksi (mentah):', suspiciousKeys);
}

if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_DATABASE) {
    if (loadedEnvPath) {
        console.warn('[ENV] Mencoba robust parse fallback untuk file:', loadedEnvPath);
        const added = robustParseEnv(loadedEnvPath);
        if (Object.keys(added).length) {
            console.log('[ENV] Hasil robust parse menambahkan keys:', Object.keys(added));
        }
    }
}

// --- Environment Diagnostics (untuk troubleshooting login) ---
const requiredEnv = ['DB_HOST','DB_USER','DB_PASSWORD','DB_DATABASE','JWT_SECRET'];
requiredEnv.forEach(key => {
    if (!process.env[key] || process.env[key].length === 0) {
        console.warn(`[ENV WARN] Variabel ${key} kosong atau tidak terdefinisi.`);
    }
});
console.log('ENV SUMMARY:', {
    DB_HOST: process.env.DB_HOST,
    DB_USER: process.env.DB_USER,
    DB_DATABASE: process.env.DB_DATABASE,
    HAS_JWT_SECRET: !!process.env.JWT_SECRET,
});

// Hard fail early if critical env still missing (agar tidak bingung di tahap login)
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_DATABASE) {
    console.error('\n[ENV FATAL] Variabel DB_HOST / DB_USER / DB_DATABASE masih kosong.');
    console.error('> Pastikan file .env berada di folder be-pinjam-master dan berisi nilai seperti:');
    console.error('  DB_HOST=localhost');
    console.error('  DB_USER=root');
    console.error('  DB_DATABASE=pinjam_kuy');
    console.error('\n[DEBUG] Path file server.js :', __filename);
    console.error('[DEBUG] Working directory    :', process.cwd());
    console.error('[DEBUG] Kandidat .env dicek  :', envPathCandidates);
    console.error('[DEBUG] Loaded from          :', loadedEnvPath || '(NOT LOADED)');
    console.error('> Jika kamu baru saja membuat .env, SIMPAN file lalu restart: node server.js');
    process.exit(1);
}

const app = express();
// Catatan PORT:
// Jika PORT ditentukan di environment (process.env.PORT), kita akan pakai apa adanya.
// Jika tidak, kita mulai dari 5000 dan jika bentrok (EADDRINUSE) kita coba increment (5001, 5002, ...)
const INITIAL_PORT = parseInt(process.env.PORT, 10) || 5000;

// --- 2. Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let pool;

// Fungsi Koneksi Database (Menggunakan mysql2/promise)
async function connectDB() {
    try {
        const baseConfig = {
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            multipleStatements: true // untuk impor schema fallback gabungan
        };

        const dbName = process.env.DB_DATABASE;
        if (!dbName) throw new Error('DB_DATABASE env tidak di-set.');

        try {
            pool = mysql.createPool({ ...baseConfig, database: dbName });
            await pool.query('SELECT 1');
        } catch (err) {
            if (err && err.code === 'ER_BAD_DB_ERROR') {
                console.warn(`⚠️  Database '${dbName}' belum ada. Membuat dan mengimpor schema...`);
                // Buat koneksi tanpa database untuk create DB
                const tmp = await mysql.createConnection(baseConfig);
                await tmp.query(`CREATE DATABASE \`${dbName}\``);
                console.log(`✅ Database '${dbName}' dibuat.`);
                await tmp.end();
                // Re-init pool dengan database
                pool = mysql.createPool({ ...baseConfig, database: dbName });
                await importSchema(pool);
            } else {
                throw err;
            }
        }

        // Setelah pool siap, cek apakah tabel inti ada. Jika tidak, impor schema.
    await ensureCoreTables(pool);
    // Diagnostik: tampilkan tabel yang ada setelah ensureCoreTables
    try {
      const [tblRows] = await pool.query('SHOW TABLES');
      console.log('[DB] Daftar tabel setelah ensureCoreTables:', tblRows.map(r=>Object.values(r)[0]));
    } catch(diagErr){
      console.warn('[DB] Gagal SHOW TABLES untuk diagnosa:', diagErr.message);
    }

    // Jalankan migrasi tambahan setelah core tables dipastikan ada
    await ensureLoanMigrations(pool);
    await ensureBooksDescriptionColumn(pool);
    await ensureLoanKodePinjam(pool);
    await ensureLoanStatusEnum(pool);
    await normalizeLoanStatuses(pool);
    await ensureLoanReturnColumns(pool);
    await ensureUserUnpaidFineColumn(pool); // NEW: pastikan kolom denda_unpaid ada
    await ensureLoanFinePaymentColumns(pool); // NEW: kolom status pembayaran denda

        // Simpan pool di app untuk diakses oleh routes (WAJIB)
        app.set('dbPool', pool);
        console.log('✅ Database terhubung dengan sukses!');
        console.log('[DEBUG] connectDB() selesai tanpa error. Menunggu seed data...');
    } catch (error) {
        console.error('❌ Gagal terhubung ke database:', error.message);
        console.error('[DEBUG] Full error:', error);
        // Exit process jika koneksi gagal
        process.exit(1); 
    }
}

// Cek dan jalankan migrasi sederhana untuk kolom baru loans (kodePinjam, purpose)
async function ensureLoanMigrations(pool) {
    try {
        const [cols] = await pool.query("SHOW COLUMNS FROM loans");
        const names = cols.map(c => c.Field);
        const needKode = !names.includes('kodePinjam');
        const needPurpose = !names.includes('purpose');
        if (needKode || needPurpose) {
            console.log('[MIGRATION] Menambahkan kolom baru pada tabel loans ...');
            await pool.query("ALTER TABLE loans " +
                (needKode ? "ADD COLUMN kodePinjam varchar(40) NULL AFTER status" : '') +
                (needKode && needPurpose ? ', ' : '') +
                (needPurpose ? "ADD COLUMN purpose text NULL" : '')
            );
            if (needKode) {
                try { await pool.query('ALTER TABLE loans ADD UNIQUE KEY uniq_kodePinjam (kodePinjam)'); } catch {}
            }
            console.log('[MIGRATION] Kolom loans diperbarui.');
        }
    } catch (e) {
        console.warn('[MIGRATION] Gagal memeriksa/menambah kolom loans:', e.message);
    }
}

// Import schema dari file sql jika tabel belum ada
async function importSchema(pool) {
    // Prefer clean schema
    const cleanPath = path.join(__dirname, 'sql', 'pinjam-kuy-clean.sql');
    const legacyPath = path.join(__dirname, 'sql', 'pinjam-kuy.sql');
    const schemaPath = fs.existsSync(cleanPath) ? cleanPath : legacyPath;
    if (!fs.existsSync(schemaPath)) {
        console.warn('⚠️  Tidak menemukan file schema (clean maupun legacy).');
        return;
    }
    try {
        const raw = fs.readFileSync(schemaPath, 'utf8');
        // Split manual per delimiter ';' + tangani komentar dan baris kosong
        const statements = raw
            .replace(/\/\*![\s\S]*?\*\/;/g, '')
            .split(/;\s*\n/)
            .map(s => s.trim())
            .filter(s => s.length && !s.startsWith('--') && !s.startsWith('/*'));

        const verbose = process.env.SCHEMA_DEBUG === 'true' || process.env.AUTH_DEBUG === 'true';
        let executed = 0;
        for (const stmt of statements) {
            try {
                if (verbose) console.log('[SCHEMA] Exec:', stmt.substring(0, 80).replace(/\s+/g,' '));
                await pool.query(stmt);
                executed++;
            } catch (e) {
                if (/^(START TRANSACTION|COMMIT|SET |LOCK |UNLOCK )/i.test(stmt)) continue;
                console.warn('⚠️  Gagal eksekusi statement schema (diabaikan):', e.message);
            }
        }
        console.log(`✅ Schema database berhasil diimpor (statements sukses: ${executed}/${statements.length}).`);
    } catch (e) {
        console.error('❌ Gagal mengimpor schema:', e.message);
    }
}

// Daftar tabel inti yang wajib ada agar aplikasi berfungsi
const CORE_TABLES = ['users', 'books', 'loans'];

async function getExistingTables(pool) {
    const [rows] = await pool.query(`SHOW TABLES`);
    // Struktur hasil SHOW TABLES: array objek dengan key 'Tables_in_<dbname>'
    const tables = rows.map(obj => Object.values(obj)[0]);
    return tables;
}

async function getMissingCoreTables(pool) {
    try {
        const existing = await getExistingTables(pool);
        return CORE_TABLES.filter(t => !existing.includes(t));
    } catch (e) {
        console.warn('⚠️  Gagal memeriksa tabel yang ada:', e.message);
        return CORE_TABLES; // jika gagal cek, asumsi semua hilang untuk memicu impor
    }
}

async function ensureCoreTables(pool) {
    const missing = await getMissingCoreTables(pool);
    if (missing.length) {
        console.warn('⚠️  Tabel inti hilang:', missing, '-> mencoba impor schema...');
        await importSchema(pool);
        const stillMissing = await getMissingCoreTables(pool);
        if (stillMissing.length) {
            console.error('❌ Masih ada tabel hilang setelah impor schema (akan coba fallback gabungan multipleStatements):', stillMissing);
            await importSchemaFallbackCombined(pool);
            const afterFallback = await getMissingCoreTables(pool);
            if (afterFallback.length) {
                console.error('❌ Fallback gabungan gagal membuat tabel:', afterFallback, '-> mencoba direct CREATE TABLE minimal');
                await createCoreTablesDirect(pool, afterFallback);
                const afterDirect = await getMissingCoreTables(pool);
                if (afterDirect.length) {
                    console.error('❌ Direct CREATE TABLE juga gagal untuk:', afterDirect, 'Periksa hak akses user database atau error di log MySQL.');
                } else {
                    console.log('✅ Direct CREATE TABLE berhasil membuat semua tabel inti.');
                    await seedAdminIfNeeded(pool);
                }
            } else {
                console.log('✅ Fallback gabungan berhasil membuat semua tabel inti.');
                await seedAdminIfNeeded(pool);
            }
        } else {
            console.log('✅ Semua tabel inti tersedia setelah impor schema.');
            await seedAdminIfNeeded(pool);
        }
    } else {
        console.log('✅ Semua tabel inti sudah ada.');
        await seedAdminIfNeeded(pool);
    }

    // Ensure returnProofMetadata column exists
    await ensureReturnProofMetadataColumn(pool);

    // Setelah tabel pasti ada, pastikan data minimal ter-seed (users lain & sample books optional)
    try {
        const seedResult = await ensureSeedData(pool, { force: false });
        if (seedResult && !seedResult.skipped) {
            console.log('[SEED] Hasil seeding:', JSON.stringify(seedResult));
        }
    } catch (e) {
        console.warn('⚠️  Gagal menjalankan seeding data:', e.message);
    }
}

async function ensureReturnProofMetadataColumn(pool) {
    try {
        const [cols] = await pool.query("SHOW COLUMNS FROM loans LIKE 'returnProofMetadata'");
        if (cols.length === 0) {
            console.log('[MIGRATION] Adding returnProofMetadata column...');
            await pool.query(`
                ALTER TABLE loans 
                ADD COLUMN returnProofMetadata JSON NULL 
                COMMENT 'Metadata foto pengembalian: koordinat, waktu, alamat' 
                AFTER returnProofUrl
            `);
            console.log('✅ returnProofMetadata column added successfully.');
        } else {
            console.log('✅ returnProofMetadata column already exists.');
        }
    } catch (e) {
        console.warn('⚠️  Failed to add returnProofMetadata column:', e.message);
    }
}

// Fallback: hapus komentar lalu eksekusi seluruh file sekaligus (butuh multipleStatements: true)
async function importSchemaFallbackCombined(pool) {
    const cleanPath = path.join(__dirname, 'sql', 'pinjam-kuy-clean.sql');
    const legacyPath = path.join(__dirname, 'sql', 'pinjam-kuy.sql');
    const schemaPath = fs.existsSync(cleanPath) ? cleanPath : legacyPath;
    if (!fs.existsSync(schemaPath)) {
        console.warn('⚠️  File schema untuk fallback tidak ditemukan (clean & legacy).');
        return;
    }
    try {
        let raw = fs.readFileSync(schemaPath, 'utf8');
        // Hilangkan komentar baris & blok dasar (tidak agresif terhadap konten dalam kutip)
        raw = raw.replace(/--.*$/gm, '')
                 .replace(/\/\*[\s\S]*?\*\//g, '')
                 .trim();
        if (!raw.endsWith(';')) raw += ';';
        console.warn('⚠️  Menjalankan fallback impor schema gabungan...');
        await pool.query(raw);
        console.log('✅ Fallback impor schema gabungan selesai.');
    } catch (e) {
        console.error('❌ Fallback impor schema gagal:', e.message);
    }
}

// Direct creation minimal definitions if SQL import keeps failing
async function createCoreTablesDirect(pool, tablesToCreate) {
    const createStatements = {
        users: `CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            npm VARCHAR(255) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            username VARCHAR(255) NOT NULL,
            angkatan VARCHAR(255) NULL,
            fakultas VARCHAR(255) NULL,
            prodi VARCHAR(255) NULL,
            role ENUM('user','admin') DEFAULT 'user',
            profile_photo_url VARCHAR(255) NULL,
            denda DECIMAL(10,2) DEFAULT 0.00,
            active_loans_count INT DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
        books: `CREATE TABLE IF NOT EXISTS books (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            kodeBuku VARCHAR(50) NOT NULL UNIQUE,
            author VARCHAR(255) NOT NULL,
            publisher VARCHAR(255) NULL,
            publicationYear YEAR(4) NULL,
            totalStock INT NOT NULL DEFAULT 0,
            availableStock INT NOT NULL DEFAULT 0,
            category VARCHAR(100) NOT NULL,
            image_url VARCHAR(255) NULL,
            location VARCHAR(100) NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
        loans: `CREATE TABLE IF NOT EXISTS loans (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            book_id INT NOT NULL,
            loanDate DATETIME NULL,
            expectedReturnDate DATE NULL,
            actualReturnDate DATETIME NULL,
            status ENUM('Menunggu Persetujuan','Sedang Dipinjam','Terlambat','Siap Dikembalikan','Dikembalikan','Ditolak') DEFAULT 'Menunggu Persetujuan',
            fineAmount INT DEFAULT 0,
            finePaid INT DEFAULT 0,
            rejectionDate DATETIME NULL,
            KEY user_id (user_id),
            KEY book_id (book_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
    };
    for (const t of tablesToCreate) {
        if (!createStatements[t]) continue;
        try {
            console.warn('[DIRECT SCHEMA] Creating table', t);
            await pool.query(createStatements[t]);
        } catch (e) {
            console.error('❌ Direct create gagal untuk', t, e.message);
        }
    }
    // Tambahkan foreign key loans jika semua tersedia
    try {
        const missing = await getMissingCoreTables(pool);
        if (!missing.includes('users') && !missing.includes('books') && !missing.includes('loans')) {
            await pool.query(`ALTER TABLE loans
                ADD CONSTRAINT loans_user_fk FOREIGN KEY (user_id) REFERENCES users(id),
                ADD CONSTRAINT loans_book_fk FOREIGN KEY (book_id) REFERENCES books(id)`);
        }
    } catch (e) {
        if (!/Duplicate|exists/i.test(e.message)) {
            console.warn('⚠️  Gagal menambah foreign keys (diabaikan):', e.message);
        }
    }
}

async function seedAdminIfNeeded(pool) {
    try {
        const [rows] = await pool.query('SELECT id FROM users WHERE npm = ? LIMIT 1', ['123456']);
        if (rows.length === 0) {
            const hash = '$2b$10$IKolWxl/DByohJrDrc2qCOKXeMNrHfDN9AYKiSBkryefB/Uz3i7rK'; // dari dump
            await pool.query('INSERT INTO users (npm,password,username,role) VALUES (?,?,?,?)', ['123456', hash, 'Admin Perpustakaan', 'admin']);
            console.log('✅ Admin default (npm 123456) ditambahkan.');
        }
    } catch (e) {
        if (/ER_NO_SUCH_TABLE/.test(e.message)) {
            console.warn('⚠️  seedAdminIfNeeded: tabel users belum tersedia.');
        } else {
            console.warn('⚠️  Gagal seed admin (diabaikan):', e.message);
        }
    }
}

// Inisiasi Koneksi dengan proper error handling
connectDB().catch((err) => {
    console.error('❌ Fatal error in connectDB:', err);
    process.exit(1);
});

// Safety: ensure req.app has dbPool on every request
app.use((req, res, next) => {
    try {
        if (!req.app.get('dbPool') && pool) {
            req.app.set('dbPool', pool);
        }
    } catch {}
    next();
});

// --- 3. Mount Static Files (WAJIB untuk Cover Buku) ---
// Membuat folder 'uploads' dapat diakses dari URL /uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- 4. Mount Routes ---
app.use('/api/admin', adminRoutes); 
app.use('/api/auth', authRoutes); 
app.use('/api/loans', loanRoutes); 
app.use('/api/books', bookRoutes); 
app.use('/api/profile', profileRoutes);

// Endpoint health sederhana untuk cek server hidup
app.get('/api/health', (req, res) => {
    return res.json({ ok: true, time: new Date().toISOString() });
});

// Endpoint debug: list users (masked) - NON PRODUCTION
app.get('/api/debug/users', async (req, res) => {
    try {
        const pool = req.app.get('dbPool');
        const [rows] = await pool.query('SELECT id, npm, username, role, LEFT(password, 7) AS pwd_prefix FROM users LIMIT 20');
        return res.json({ count: rows.length, users: rows });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// Endpoint debug manual untuk memicu impor schema kembali (NON-PRODUCTION)
app.post('/api/debug/import-schema', async (req, res) => {
    try {
        const pool = req.app.get('dbPool');
        if (!pool) return res.status(500).json({ ok: false, message: 'Pool belum siap.' });
        await importSchema(pool);
        // Opsional: cek ulang tabel setelah impor
        const missing = await getMissingCoreTables(pool);
        if (missing.length) {
            return res.status(500).json({ ok: false, message: 'Schema diimpor tapi masih ada tabel hilang.', missing });
        }
        return res.json({ ok: true, message: 'Schema berhasil diimpor ulang.' });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Endpoint debug untuk reseed data (users tambahan & sample books)
app.post('/api/debug/reseed', async (req, res) => {
    try {
        const pool = req.app.get('dbPool');
        if (!pool) return res.status(500).json({ ok: false, message: 'Pool belum siap.' });
        const result = await ensureSeedData(pool, { force: true });
        return res.json({ ok: true, result });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Endpoint debug: lihat struktur kolom loans & 5 data terbaru
app.get('/api/debug/loan-columns', async (req, res) => {
    try {
        const pool = req.app.get('dbPool');
        if(!pool) return res.status(500).json({ ok:false, message:'Pool belum siap.' });
        const [cols] = await pool.query('SHOW COLUMNS FROM loans');
        let sample = [];
        try { [sample] = await pool.query('SELECT id, status, kodePinjam, loanDate, expectedReturnDate FROM loans ORDER BY id DESC LIMIT 5'); } catch {}
        return res.json({ ok:true, columns: cols, sample });
    } catch (e){
        return res.status(500).json({ ok:false, error: e.message });
    }
});

// --- 5. Jalankan Server dengan Fallback Port Dinamis ---
function startServer(port, attempt = 1, maxAttempts = 8) {
    const server = app.listen(port, () => {
        console.log(`🚀 Server berjalan di http://localhost:${port}`);
        if (!process.env.PORT && port !== INITIAL_PORT) {
            console.log(`ℹ️  Menggunakan port alternatif karena port ${INITIAL_PORT} sedang dipakai.`);
        }
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            if (process.env.PORT) {
                console.error(`❌ Port ${port} (dari ENV) sudah dipakai. Silakan kosongkan port atau ubah variabel PORT.`);
                process.exit(1);
            } else if (attempt < maxAttempts) {
                const nextPort = port + 1;
                console.warn(`⚠️  Port ${port} dipakai. Mencoba port ${nextPort} (percobaan ${attempt + 1}/${maxAttempts})...`);
                setTimeout(() => startServer(nextPort, attempt + 1, maxAttempts), 200);
            } else {
                console.error(`❌ Gagal menemukan port kosong setelah ${maxAttempts} percobaan.`);
                process.exit(1);
            }
        } else {
            console.error('❌ Error saat menjalankan server:', err);
            process.exit(1);
        }
    });
}

startServer(INITIAL_PORT);

// Pastikan kolom & isi kodePinjam dibangkitkan untuk semua baris lama setelah startup
async function ensureLoanKodePinjam(pool){
    try {
        const [cols] = await pool.query('SHOW COLUMNS FROM loans');
        const names = cols.map(c=>c.Field);
        let altered = false;
        if(!names.includes('kodePinjam')){ 
            await pool.query("ALTER TABLE loans ADD COLUMN kodePinjam varchar(40) NULL AFTER status");
            try { await pool.query('ALTER TABLE loans ADD UNIQUE KEY uniq_kodePinjam (kodePinjam)'); } catch {}
            altered = true; 
        }
        if(!names.includes('purpose')){ 
            await pool.query("ALTER TABLE loans ADD COLUMN purpose text NULL");
            altered = true; 
        }
        if(altered){
            console.log('[STARTUP] Kolom loans diperbarui (kodePinjam/purpose).');
        }
        // Backfill kodePinjam kosong
        const [missing] = await pool.query("SELECT id, loanDate FROM loans WHERE (kodePinjam IS NULL OR kodePinjam='') LIMIT 500");
        if(missing.length){
            console.log(`[STARTUP] Backfilling kodePinjam untuk ${missing.length} baris...`);
            for(const row of missing){
                const baseDate = row.loanDate ? new Date(row.loanDate) : new Date();
                const yyyy = baseDate.getFullYear();
                const mm = String(baseDate.getMonth()+1).padStart(2,'0');
                const dd = String(baseDate.getDate()).padStart(2,'0');
                const rnd = Math.random().toString(36).substring(2,6).toUpperCase();
                const code = `KP-${yyyy}${mm}${dd}-${rnd}`;
                try {
                    await pool.query("UPDATE loans SET kodePinjam = ? WHERE id = ? AND (kodePinjam IS NULL OR kodePinjam = '')", [code, row.id]);
                } catch (e) {
                    // fallback deterministik
                    const fallback = `KP-${String(row.id).padStart(6,'0')}`;
                    try { await pool.query("UPDATE loans SET kodePinjam = ? WHERE id = ? AND (kodePinjam IS NULL OR kodePinjam = '')", [fallback, row.id]); } catch {}
                }
            }
            console.log('[STARTUP] Backfill kodePinjam selesai.');
        }
    } catch (e){
        console.warn('[STARTUP] ensureLoanKodePinjam gagal:', e.message);
    }
}

// Pastikan enum status loans mencakup status baru (Disetujui, Diambil)
async function ensureLoanStatusEnum(pool){
    try {
        const [rows] = await pool.query("SHOW COLUMNS FROM loans LIKE 'status'");
        if(!rows.length) return; // tidak ada kolom
        const type = rows[0].Type; // example: enum('Menunggu Persetujuan','Sedang Dipinjam',...)
        const needed = ['Disetujui','Diambil'];
        const missing = needed.filter(s => !type.includes(`'${s}'`));
        if(missing.length){
            // Ambil semua nilai enum lama
            const matches = type.match(/enum\((.*)\)/i);
            if(!matches) return;
            const inside = matches[1];
            // Convert to array preserving order
            const parts = inside.split(/,(?=(?:[^']*'[^']*')*[^']*$)/).map(p=>p.trim()).filter(Boolean);
            // Insert new statuses setelah 'Menunggu Persetujuan' agar logis
            const existingValues = parts.map(p=>p.replace(/^'(.*)'$/,'$1'));
            for(const val of needed){ if(!existingValues.includes(val)) existingValues.push(val); }
            // Rebuild enum string
            const enumDef = existingValues.map(v=>`'${v}'`).join(',');
            const alter = `ALTER TABLE loans MODIFY COLUMN status ENUM(${enumDef}) DEFAULT 'Menunggu Persetujuan'`;
            try {
                await pool.query(alter);
                console.log('[MIGRATION] Enum loans.status diperbarui dengan nilai baru:', needed.join(', '));
            } catch (e){ console.warn('[MIGRATION] Gagal update enum status:', e.message); }
        }
    } catch (e){
        console.warn('[MIGRATION] ensureLoanStatusEnum error:', e.message);
    }
}

// Normalisasi status lama: ubah status kosong atau NULL menjadi 'Menunggu Persetujuan', ubah 'Disetujui' langsung ke 'Sedang Dipinjam' jika sudah punya loanDate
async function normalizeLoanStatuses(pool){
    try {
        const fixes = [];
        const [emptyRows] = await pool.query("SELECT id FROM loans WHERE (status IS NULL OR status='')");
        if (emptyRows.length){
            await pool.query("UPDATE loans SET status='Menunggu Persetujuan' WHERE (status IS NULL OR status='')");
            fixes.push(`Kosong->Menunggu (${emptyRows.length})`);
        }
        const [approvedRows] = await pool.query("SELECT id FROM loans WHERE status='Disetujui'");
        if (approvedRows.length){
            // Langsung aktifkan dengan expectedReturnDate jika belum ada
            await pool.query("UPDATE loans SET status='Sedang Dipinjam', expectedReturnDate = IF(expectedReturnDate IS NULL, DATE_ADD(COALESCE(loanDate,NOW()), INTERVAL 21 DAY), expectedReturnDate) WHERE status='Disetujui'");
            fixes.push(`Disetujui->Sedang Dipinjam (${approvedRows.length})`);
        }
        if (fixes.length) console.log('[NORMALIZE] Status loan diperbarui:', fixes.join(', '));
    } catch (e){
        console.warn('[NORMALIZE] Gagal normalisasi status:', e.message);
    }
}

// Tambah kolom untuk bukti pengembalian jika belum ada
async function ensureLoanReturnColumns(pool){
    try {
        const [cols] = await pool.query("SHOW COLUMNS FROM loans");
        const names = cols.map(c=>c.Field);
        const needProof = !names.includes('returnProofUrl');
        const needReadyDate = !names.includes('readyReturnDate');
        const needApprovedAt = !names.includes('approvedAt');
        const needUserNotified = !names.includes('userNotified');
        const needReturnNotified = !names.includes('returnNotified');
        const needRejectionNotified = !names.includes('rejectionNotified');
        const needReturnDecision = !names.includes('returnDecision');
        if(needProof || needReadyDate){
            let alters = [];
            if(needProof) alters.push('ADD COLUMN returnProofUrl varchar(255) NULL AFTER actualReturnDate');
            if(needReadyDate) alters.push('ADD COLUMN readyReturnDate DATETIME NULL AFTER returnProofUrl');
            const sql = `ALTER TABLE loans ${alters.join(', ')}`;
            await pool.query(sql);
            console.log('[MIGRATION] Kolom bukti pengembalian ditambahkan.');
        }
        if (needApprovedAt || needUserNotified || needReturnNotified || needReturnDecision || needRejectionNotified){
            let alters2 = [];
            if (needApprovedAt) alters2.push('ADD COLUMN approvedAt DATETIME NULL AFTER expectedReturnDate');
            if (needUserNotified) alters2.push("ADD COLUMN userNotified TINYINT(1) NOT NULL DEFAULT 0 AFTER approvedAt");
            if (needReturnNotified) alters2.push("ADD COLUMN returnNotified TINYINT(1) NOT NULL DEFAULT 0 AFTER userNotified");
            if (needReturnDecision) alters2.push("ADD COLUMN returnDecision ENUM('approved','rejected') NULL AFTER returnNotified");
            if (needRejectionNotified) alters2.push("ADD COLUMN rejectionNotified TINYINT(1) NOT NULL DEFAULT 0 AFTER returnDecision");
            const sql2 = `ALTER TABLE loans ${alters2.join(', ')}`;
            await pool.query(sql2);
            console.log('[MIGRATION] Kolom notifikasi approval/pengembalian ditambahkan.');
        }
    } catch(e){
        console.warn('[MIGRATION] ensureLoanReturnColumns gagal:', e.message);
    }
}

// Tambah kolom denda_unpaid pada users jika belum ada
async function ensureUserUnpaidFineColumn(pool){
    try {
        const [cols] = await pool.query("SHOW COLUMNS FROM users LIKE 'denda_unpaid'");
        if (!cols.length){
            await pool.query("ALTER TABLE users ADD COLUMN denda_unpaid DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER denda");
            console.log('[MIGRATION] Kolom users.denda_unpaid ditambahkan.');
        }
    } catch (e){
        console.warn('[MIGRATION] ensureUserUnpaidFineColumn gagal:', e.message);
    }
}

// Tambah kolom status pembayaran denda pada loans
async function ensureLoanFinePaymentColumns(pool){
    try {
        const [cols] = await pool.query('SHOW COLUMNS FROM loans');
        const names = cols.map(c=>c.Field);
        const needStatus = !names.includes('finePaymentStatus');
        const needMethod = !names.includes('finePaymentMethod');
        const needProof = !names.includes('finePaymentProof');
        const needPaidAt = !names.includes('finePaymentAt');
        if (needStatus || needMethod || needProof || needPaidAt){
            const parts = [];
            if (needStatus) parts.push("ADD COLUMN finePaymentStatus ENUM('unpaid','awaiting_proof','pending_verification','paid') NOT NULL DEFAULT 'unpaid' AFTER finePaid");
            if (needMethod) parts.push("ADD COLUMN finePaymentMethod VARCHAR(30) NULL AFTER finePaymentStatus");
            if (needProof) parts.push("ADD COLUMN finePaymentProof VARCHAR(255) NULL AFTER finePaymentMethod");
            if (needPaidAt) parts.push("ADD COLUMN finePaymentAt DATETIME NULL AFTER finePaymentProof");
            const sql = `ALTER TABLE loans ${parts.join(', ')}`;
            await pool.query(sql);
            console.log('[MIGRATION] Kolom pembayaran denda (finePayment*) ditambahkan.');
        }
        // Sinkronisasi nilai lama: jika finePaid=1 tapi status masih unpaid -> set paid
        const [needSync] = await pool.query("SELECT COUNT(*) as c FROM loans WHERE finePaid = 1 AND (finePaymentStatus IS NULL OR finePaymentStatus='unpaid')");
        if (needSync[0].c > 0){
            await pool.query("UPDATE loans SET finePaymentStatus='paid' WHERE finePaid=1 AND (finePaymentStatus IS NULL OR finePaymentStatus='unpaid')");
            console.log(`[MIGRATION] Sinkronisasi ${needSync[0].c} baris finePaymentStatus -> paid.`);
        }
    } catch (e){
        console.warn('[MIGRATION] ensureLoanFinePaymentColumns gagal:', e.message);
    }
}

// Tambah kolom description pada books jika belum ada
async function ensureBooksDescriptionColumn(pool){
    try {
        const [cols] = await pool.query("SHOW COLUMNS FROM books LIKE 'description'");
        if (!cols.length){
            await pool.query("ALTER TABLE books ADD COLUMN description TEXT NULL AFTER image_url");
            console.log('[MIGRATION] Kolom books.description ditambahkan.');
        }
    } catch (e){
        console.warn('[MIGRATION] ensureBooksDescriptionColumn gagal:', e.message);
    }
}

// ===== GLOBAL ERROR HANDLERS =====
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Promise Rejection:', reason);
    console.error('Promise:', promise);
    // Don't exit immediately, log it for debugging
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});