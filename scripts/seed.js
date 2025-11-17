require('ts-node/register');
require('tsconfig-paths/register');

const mongoose = require('mongoose');
const { seeder } = require('../src/db/umzug');

async function runSeeder() {
  try {
    // 1. Kết nối MongoDB
    await mongoose.connect('mongodb://localhost:27017/joblance-users');
    console.log('✅ MongoDB connected');

    // 2. Chạy seeder
    await seeder.runAsCLI();

    // 3. Đóng connection sau khi xong
    await mongoose.disconnect();
    console.log('✅ Seeder completed, MongoDB disconnected');
  } catch (err) {
    console.error('❌ Seeder failed:', err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

runSeeder();
