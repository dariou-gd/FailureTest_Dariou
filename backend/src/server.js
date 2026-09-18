import dotenv from 'dotenv';

// Cargar variables de entorno PRIMERO, antes de importar cualquier otro módulo
dotenv.config({ quiet: true });

import app from './app.js';
import connectDB from './config/db.js';
import { startInventoryJobs } from './jobs/inventoryJobs.js';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`API de inventario lista en http://localhost:${PORT}`);

    // Start background jobs
    startInventoryJobs();
  });
};

startServer();
