const mongoose = require('mongoose');

let connectionPromise = null;

function getMongoUri() {
  const uri = process.env.MONGODB_URI;

  if (!uri || typeof uri !== 'string' || !uri.trim()) {
    throw new Error('MONGODB_URI is required');
  }

  return uri.trim();
}

async function connectDB() {
  // Reuse an already established connection across warm Vercel invocations.
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  // Reuse an in-flight connection attempt so concurrent requests do not
  // create multiple MongoDB connections during a cold start.
  if (connectionPromise) {
    return connectionPromise;
  }

  const uri = getMongoUri();
  const maxPoolSize = Number(process.env.MONGO_MAX_POOL_SIZE || 10);
  const minPoolSize = Number(process.env.MONGO_MIN_POOL_SIZE || 0);

  if (!Number.isInteger(maxPoolSize) || maxPoolSize < 1 || maxPoolSize > 50) {
    throw new Error('MONGO_MAX_POOL_SIZE must be an integer between 1 and 50');
  }

  if (!Number.isInteger(minPoolSize) || minPoolSize < 0 || minPoolSize > maxPoolSize) {
    throw new Error('MONGO_MIN_POOL_SIZE must be an integer between 0 and MONGO_MAX_POOL_SIZE');
  }

  connectionPromise = mongoose.connect(uri, {
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000),
    connectTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 10000),
    socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000),
    maxPoolSize,
    minPoolSize,
    maxIdleTimeMS: 30000,
    family: 4,
    bufferCommands: false,
  })
    .then((connection) => {
      console.log('MongoDB Connected');
      return connection;
    })
    .catch((error) => {
      connectionPromise = null;
      console.error('MongoDB Connection Error:', error.message);
      throw error;
    });

  return connectionPromise;
}

mongoose.connection.on('disconnected', () => {
  connectionPromise = null;
  console.warn('MongoDB disconnected');
});

mongoose.connection.on('error', (error) => {
  console.error('MongoDB connection error:', error.message);
});

module.exports = connectDB;
