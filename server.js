// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:4000', 'http://localhost:5500', 'http://127.0.0.1:3000'],
  credentials: true
}));
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Models
const noteSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    title: { type: String, default: 'Untitled Note' },
    content: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Note = mongoose.model('Note', noteSchema);

// Google Auth Configuration
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(CLIENT_ID);

// Authentication Middleware
async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    
    try {
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: CLIENT_ID
        });
        
        const payload = ticket.getPayload();
        req.user = {
            id: payload['sub'],
            email: payload['email'],
            name: payload['name']
        };
        
        next();
    } catch (error) {
        console.error('Authentication error:', error);
        res.status(403).json({ error: 'Invalid token' });
    }
}

// Routes
// Get all notes for a user
app.get('/api/notes', authenticateToken, async (req, res) => {
    try {
        const notes = await Note.find({ userId: req.user.id })
            .sort({ updatedAt: -1 });
        res.json(notes);
    } catch (error) {
        console.error('Error fetching notes:', error);
        res.status(500).json({ error: 'Failed to fetch notes' });
    }
});

// Get a specific note
app.get('/api/notes/:id', authenticateToken, async (req, res) => {
    try {
        const note = await Note.findOne({ 
            _id: req.params.id,
            userId: req.user.id 
        });
        
        if (!note) return res.status(404).json({ error: 'Note not found' });
        
        res.json(note);
    } catch (error) {
        console.error('Error fetching note:', error);
        res.status(500).json({ error: 'Failed to fetch note' });
    }
});

// Create a new note
app.post('/api/notes', authenticateToken, async (req, res) => {
    try {
        const { title, content } = req.body;
        
        const note = new Note({
            userId: req.user.id,
            title: title || 'Untitled Note',
            content: content || ''
        });
        
        await note.save();
        res.status(201).json(note);
    } catch (error) {
        console.error('Error creating note:', error);
        res.status(500).json({ error: 'Failed to create note' });
    }
});

// Update a note
app.put('/api/notes/:id', authenticateToken, async (req, res) => {
    try {
        const { title, content } = req.body;
        
        const note = await Note.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { 
                title, 
                content,
                updatedAt: Date.now()
            },
            { new: true }
        );
        
        if (!note) return res.status(404).json({ error: 'Note not found' });
        
        res.json(note);
    } catch (error) {
        console.error('Error updating note:', error);
        res.status(500).json({ error: 'Failed to update note' });
    }
});

// Delete a note
app.delete('/api/notes/:id', authenticateToken, async (req, res) => {
    try {
        const result = await Note.findOneAndDelete({
            _id: req.params.id,
            userId: req.user.id
        });
        
        if (!result) return res.status(404).json({ error: 'Note not found' });
        
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting note:', error);
        res.status(500).json({ error: 'Failed to delete note' });
    }
});

// AI Endpoints
// Summarize text
app.post('/api/ai/summarize', authenticateToken, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'No text provided' });

        const result = await model.generateContent(`Summarize the following text:\n\n${text}`);
        const response = await result.response;
        res.json({ result: response.text() });
    } catch (error) {
        console.error('Gemini error:', error);
        res.status(500).json({ error: 'Failed to summarize text' });
    }
});

// Improve writing
app.post('/api/ai/improve', authenticateToken, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'No text provided' });

        const result = await model.generateContent(`Improve the following text by making it more clear, concise, and professional:\n\n${text}`);
        const response = await result.response;
        res.json({ result: response.text() });
    } catch (error) {
        console.error('Gemini error:', error);
        res.status(500).json({ error: 'Failed to improve text' });
    }
});

// Generate ideas
app.post('/api/ai/ideas', authenticateToken, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'No text provided' });

        const result = await model.generateContent(`Based on the following text, suggest some related ideas, questions to explore, or points to consider:\n\n${text}`);
        const response = await result.response;
        res.json({ result: response.text() });
    } catch (error) {
        console.error('Gemini error:', error);
        res.status(500).json({ error: 'Failed to generate ideas' });
    }
});

// Add a simple test route
app.get('/api/test', (req, res) => {
    res.json({ status: 'API is working!' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});