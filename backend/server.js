// No backend/server.js, procure esta linha:
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// MUDE PARA:
app.use(cors({
  origin: true, // Permite todas as origens (seguro para desenvolvimento)
  credentials: true
}));