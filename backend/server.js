import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'findata360-dev-secret-2024';

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

app.use(express.json());

// Database setup
const db = new sqlite3.Database(join(__dirname, 'database', 'findata360.db'));

// Initialize database tables
db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    company_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Transactions table
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT CHECK(type IN ('income', 'expense')) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    transaction_date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Categories table
  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    type TEXT CHECK(type IN ('income', 'expense')) NOT NULL,
    color TEXT DEFAULT '#666666',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Insert default categories
  const defaultCategories = [
    { name: 'Salário', type: 'income', color: '#27ae60' },
    { name: 'Vendas', type: 'income', color: '#2ecc71' },
    { name: 'Investimentos', type: 'income', color: '#3498db' },
    { name: 'Outras Receitas', type: 'income', color: '#9b59b6' },
    { name: 'Alimentação', type: 'expense', color: '#e74c3c' },
    { name: 'Transporte', type: 'expense', color: '#e67e22' },
    { name: 'Moradia', type: 'expense', color: '#f39c12' },
    { name: 'Saúde', type: 'expense', color: '#d35400' },
    { name: 'Educação', type: 'expense', color: '#c0392b' },
    { name: 'Lazer', type: 'expense', color: '#8e44ad' },
    { name: 'Outras Despesas', type: 'expense', color: '#7f8c8d' }
  ];

  defaultCategories.forEach(category => {
    db.run(
      'INSERT OR IGNORE INTO categories (name, type, color) VALUES (?, ?, ?)',
      [category.name, category.type, category.color]
    );
  });
});

// Auth Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token de acesso necessário' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido ou expirado' });
    }
    req.user = user;
    next();
  });
};

// Validation middleware
const validateTransaction = (req, res, next) => {
  const { type, amount, description, category, transaction_date } = req.body;
  
  if (!type || !['income', 'expense'].includes(type)) {
    return res.status(400).json({ error: 'Tipo de transação inválido' });
  }
  
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Valor deve ser maior que zero' });
  }
  
  if (!description || description.trim().length === 0) {
    return res.status(400).json({ error: 'Descrição é obrigatória' });
  }
  
  if (!category || category.trim().length === 0) {
    return res.status(400).json({ error: 'Categoria é obrigatória' });
  }
  
  if (!transaction_date) {
    return res.status(400).json({ error: 'Data da transação é obrigatória' });
  }
  
  next();
};

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'FinData360 API está funcionando',
    timestamp: new Date().toISOString()
  });
});

// Auth routes
app.post('/api/register', async (req, res) => {
  const { email, password, company_name } = req.body;

  if (!email || !password || !company_name) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    
    db.run(
      'INSERT INTO users (email, password, company_name) VALUES (?, ?, ?)',
      [email, hashedPassword, company_name],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email já cadastrado' });
          }
          return res.status(500).json({ error: 'Erro interno do servidor' });
        }

        const token = jwt.sign({ id: this.lastID, email }, JWT_SECRET, { expiresIn: '24h' });
        res.status(201).json({
          message: 'Usuário criado com sucesso',
          token,
          user: { 
            id: this.lastID, 
            email, 
            company_name,
            created_at: new Date().toISOString()
          }
        });
      }
    );
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      console.error('Login error:', err);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

    if (!user) {
      return res.status(400).json({ error: 'Credenciais inválidas' });
    }

    try {
      const isValidPassword = await bcrypt.compare(password, user.password);
      
      if (isValidPassword) {
        const token = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: '24h' });
        res.json({
          message: 'Login realizado com sucesso',
          token,
          user: { 
            id: user.id, 
            email: user.email, 
            company_name: user.company_name,
            created_at: user.created_at
          }
        });
      } else {
        res.status(400).json({ error: 'Credenciais inválidas' });
      }
    } catch (error) {
      console.error('Password comparison error:', error);
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });
});

// Transaction routes
app.get('/api/transactions', authenticateToken, (req, res) => {
  const { page = 1, limit = 10, type, category, start_date, end_date } = req.query;
  const offset = (page - 1) * limit;

  let query = `
    SELECT * FROM transactions 
    WHERE user_id = ? 
  `;
  let params = [req.user.id];

  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }

  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  if (start_date) {
    query += ' AND transaction_date >= ?';
    params.push(start_date);
  }

  if (end_date) {
    query += ' AND transaction_date <= ?';
    params.push(end_date);
  }

  query += ' ORDER BY transaction_date DESC, created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Transactions fetch error:', err);
      return res.status(500).json({ error: 'Erro ao buscar transações' });
    }

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM transactions WHERE user_id = ?';
    let countParams = [req.user.id];

    if (type) {
      countQuery += ' AND type = ?';
      countParams.push(type);
    }

    db.get(countQuery, countParams, (countErr, countResult) => {
      if (countErr) {
        console.error('Count error:', countErr);
        return res.status(500).json({ error: 'Erro ao contar transações' });
      }

      res.json({
        transactions: rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.total,
          pages: Math.ceil(countResult.total / limit)
        }
      });
    });
  });
});

app.post('/api/transactions', authenticateToken, validateTransaction, (req, res) => {
  const { type, amount, description, category, transaction_date } = req.body;

  db.run(
    `INSERT INTO transactions (user_id, type, amount, description, category, transaction_date) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.user.id, type, parseFloat(amount), description.trim(), category.trim(), transaction_date],
    function(err) {
      if (err) {
        console.error('Transaction creation error:', err);
        return res.status(500).json({ error: 'Erro ao criar transação' });
      }

      // Return the created transaction
      db.get(
        'SELECT * FROM transactions WHERE id = ?',
        [this.lastID],
        (err, transaction) => {
          if (err) {
            return res.status(500).json({ error: 'Erro ao buscar transação criada' });
          }
          res.status(201).json({
            message: 'Transação criada com sucesso',
            transaction
          });
        }
      );
    }
  );
});

// Dashboard routes
app.get('/api/dashboard', authenticateToken, (req, res) => {
  const { start_date, end_date } = req.query;
  
  let dateFilter = '';
  const params = [req.user.id];

  if (start_date && end_date) {
    dateFilter = ' AND transaction_date BETWEEN ? AND ?';
    params.push(start_date, end_date);
  }

  const queries = {
    totalIncome: `
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM transactions 
      WHERE user_id = ? AND type = "income" ${dateFilter}
    `,
    totalExpenses: `
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM transactions 
      WHERE user_id = ? AND type = "expense" ${dateFilter}
    `,
    recentTransactions: `
      SELECT * FROM transactions 
      WHERE user_id = ? ${dateFilter}
      ORDER BY transaction_date DESC, created_at DESC 
      LIMIT 5
    `,
    categoryBreakdown: `
      SELECT category, type, SUM(amount) as total 
      FROM transactions 
      WHERE user_id = ? ${dateFilter}
      GROUP BY category, type 
      ORDER BY total DESC
    `,
    monthlyTrend: `
      SELECT 
        strftime('%Y-%m', transaction_date) as month,
        type,
        SUM(amount) as total
      FROM transactions 
      WHERE user_id = ? AND transaction_date >= date('now', '-6 months')
      GROUP BY month, type
      ORDER BY month
    `
  };

  // Execute all queries in parallel
  const results = {};

  db.get(queries.totalIncome, params, (err, income) => {
    if (err) return handleError(res, err);
    results.income = income.total;

    db.get(queries.totalExpenses, params, (err, expenses) => {
      if (err) return handleError(res, err);
      results.expenses = expenses.total;

      db.all(queries.recentTransactions, [req.user.id], (err, transactions) => {
        if (err) return handleError(res, err);
        results.recentTransactions = transactions;

        db.all(queries.categoryBreakdown, params, (err, categories) => {
          if (err) return handleError(res, err);
          results.categoryBreakdown = categories;

          db.all(queries.monthlyTrend, [req.user.id], (err, trend) => {
            if (err) return handleError(res, err);
            results.monthlyTrend = trend;

            const balance = results.income - results.expenses;

            res.json({
              summary: {
                balance,
                totalIncome: results.income,
                totalExpenses: results.expenses,
                transactionCount: results.recentTransactions.length
              },
              recentTransactions: results.recentTransactions,
              categoryBreakdown: results.categoryBreakdown,
              monthlyTrend: results.monthlyTrend
            });
          });
        });
      });
    });
  });
});

// Categories routes
app.get('/api/categories', authenticateToken, (req, res) => {
  db.all(
    `SELECT * FROM categories 
     WHERE user_id IS NULL OR user_id = ? 
     ORDER BY type, name`,
    [req.user.id],
    (err, rows) => {
      if (err) {
        console.error('Categories fetch error:', err);
        return res.status(500).json({ error: 'Erro ao buscar categorias' });
      }
      res.json(rows);
    }
  );
});

// Utility function for error handling
function handleError(res, err) {
  console.error('Database error:', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
}

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint não encontrado' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

app.listen(PORT, () => {
  console.log(`🚀 FinData360 Backend rodando na porta ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});