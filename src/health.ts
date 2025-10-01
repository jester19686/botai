import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

// Health check endpoint для Railway
app.get('/', (req, res) => {
  res.json({ 
    status: 'TGAIHelpBot is running', 
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    features: [
      'Non-blocking image processing',
      'Unified request blocking',
      'OpenRouter integration',
      'Real-time image statistics'
    ]
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    bot: 'TGAIHelpBot',
    version: '1.0.0',
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
    },
    uptime: Math.round(process.uptime())
  });
});

app.get('/status', (req, res) => {
  res.json({
    bot: 'TGAIHelpBot',
    status: 'running',
    mode: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    railway_deployment: !!process.env.RAILWAY_ENVIRONMENT
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    available_endpoints: ['/', '/health', '/status'],
    requested: req.path
  });
});

app.listen(PORT, () => {
  console.log(`🌐 Health server running on port ${PORT}`);
  console.log(`📊 Available endpoints:`);
  console.log(`   GET / - Bot status`);
  console.log(`   GET /health - Health check`);
  console.log(`   GET /status - Deployment status`);
});

export { app };
