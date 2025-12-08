const fs = require('fs');
const path = require('path');

// Regex untuk menangkap INSERT statement per tabel
function extractInsertStatements(dumpContent, tableName) {
  // Gunakan konstruktor RegExp dinamis tanpa template raw escape bermasalah
  const pattern = new RegExp('INSERT INTO `'+ tableName +'`[\\s\\S]*?;', 'g');
  const matches = dumpContent.match(pattern) || [];
  return matches;
}

async function seedUsersFromDump(pool, dumpContent) {
  const inserts = extractInsertStatements(dumpContent, 'users');
  if (!inserts.length) return { inserted: 0, skipped: 0 }; 
  let inserted = 0, skipped = 0;
  for (const stmt of inserts) {
    try {
      await pool.query(stmt);
      inserted++;
    } catch (e) {
      if (/(duplicate|exists|Duplicate entry)/i.test(e.message)) {
        skipped++;
      } else {
        console.warn('[SEED USERS] Gagal eksekusi salah satu INSERT (diabaikan):', e.message);
      }
    }
  }
  return { inserted, skipped };
}

async function seedBooksSample(pool) {
  const sampleBooks = [
    {
      title: 'Algoritma dan Struktur Data', kodeBuku: 'BK-ALG-001', author: 'Tim Dosen', publisher: 'Informatika Press', publicationYear: 2022,
      totalStock: 5, category: 'Teknik', image_url: null, location: 'Rak A1'
    },
    {
      title: 'Pengantar Basis Data', kodeBuku: 'BK-DB-001', author: 'A. Sutanto', publisher: 'Tekno Prima', publicationYear: 2021,
      totalStock: 3, category: 'Teknik', image_url: null, location: 'Rak A2'
    }
  ];
  let inserted = 0;
  for (const b of sampleBooks) {
    try {
      await pool.query(`INSERT INTO books (title, kodeBuku, author, publisher, publicationYear, totalStock, availableStock, category, image_url, location) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [b.title, b.kodeBuku, b.author, b.publisher, b.publicationYear, b.totalStock, b.totalStock, b.category, b.image_url, b.location]);
      inserted++;
    } catch (e) {
      if (!/(duplicate|Duplicate entry)/i.test(e.message)) {
        console.warn('[SEED BOOKS] Gagal tambah sample book (diabaikan):', e.message);
      }
    }
  }
  return { inserted };
}

async function ensureSeedData(pool, options = {}) {
  console.log('[SEED] ===== ensureSeedData START =====');
  const { force = false } = options;
  // Hitung user (kecuali admin default) & buku
  console.log('[SEED] Checking user count...');
  const [[userCountRow]] = await pool.query('SELECT COUNT(*) AS cnt FROM users');
  console.log('[SEED] User count:', userCountRow.cnt);
  
  console.log('[SEED] Checking book count...');
  const [[bookCountRow]] = await pool.query('SELECT COUNT(*) AS cnt FROM books');
  console.log('[SEED] Book count:', bookCountRow.cnt);
  
  const needUsers = force || userCountRow.cnt <= 1; // hanya admin atau kosong
  const needBooks = force || bookCountRow.cnt === 0;
  console.log('[SEED] Need users?', needUsers, '| Need books?', needBooks);
  
  if (!needUsers && !needBooks) {
    console.log('[SEED] ===== ensureSeedData SKIPPED =====');
    return { skipped: true };
  }

  const dumpPath = path.join(__dirname, '..', 'sql', 'pinjam-kuy.sql');
  let dumpContent = null;
  if (fs.existsSync(dumpPath)) {
    console.log('[SEED] Reading dump file...');
    try { dumpContent = fs.readFileSync(dumpPath, 'utf8'); } catch { /* ignore */ }
  }
  const result = { users: null, books: null };
  if (needUsers && dumpContent) {
    console.log('[SEED] Seeding users from dump...');
    result.users = await seedUsersFromDump(pool, dumpContent);
  }
  if (needBooks) {
    // Dump tidak punya data buku -> seed sample jika diizinkan
    if (process.env.SEED_SAMPLE_BOOKS === 'true') {
      console.log('[SEED] Seeding sample books...');
      result.books = await seedBooksSample(pool);
    } else {
      console.log('[SEED] SEED_SAMPLE_BOOKS not true, skipping books');
      result.books = { inserted: 0, note: 'SEED_SAMPLE_BOOKS != true, lewati sample.' };
    }
  }
  console.log('[SEED] ===== ensureSeedData COMPLETE =====');
  return result;
}

module.exports = { ensureSeedData };
