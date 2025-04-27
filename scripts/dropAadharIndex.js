const mongoose = require('mongoose');
require('dotenv').config();

async function dropIndex() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');
        
        const result = await mongoose.connection.db.collection('users').dropIndex('aadharNumber_1');
        console.log('Index dropped successfully:', result);
        
        await mongoose.connection.close();
        console.log('MongoDB connection closed');
    } catch (error) {
        console.error('Error dropping index:', error);
        process.exit(1);
    }
}

dropIndex(); 