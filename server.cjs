const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'db.json');

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// Ĭ�����ݽṹ
const defaultData = {
  medicines: [],
  shoppingList: [],
  logs: []
};

// ��ʼ�����ݿ��ļ�
if (!fs.existsSync(DB_FILE)) {
  console.log('Creating new database file...');
  fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
}

// ��ȡ����
app.get('/api/data', (req, res) => {
  fs.readFile(DB_FILE, 'utf8', (err, data) => {
    if (err) {
      console.error('Read Error:', err);
      return res.status(500).json({ error: 'Failed to read database' });
    }
    try {
      // ����ļ�Ϊ�գ�����Ĭ�Ͻṹ
      if (!data.trim()) {
        return res.json(defaultData);
      }
      res.json(JSON.parse(data));
    } catch (parseError) {
      console.error('Parse Error:', parseError);
      res.json(defaultData);
    }
  });
});

// ��������
app.post('/api/data', (req, res) => {
  const newData = req.body;
  // �򵥵�ȫ������д�루�ʺϼ�ͥС��ģʹ�ã�
  fs.writeFile(DB_FILE, JSON.stringify(newData, null, 2), (err) => {
    if (err) {
      console.error('Write Error:', err);
      return res.status(500).json({ error: 'Failed to save database' });
    }
    res.json({ success: true });
  });
});

// 启动服务 (本地模式)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`Data Server running at http://localhost:${PORT}`);
    console.log(`Database file location: ${DB_FILE}`);
    console.log(`==================================================\n`);
  });
}

// 导出 app 供 Vercel Serverless 使用
module.exports = app;