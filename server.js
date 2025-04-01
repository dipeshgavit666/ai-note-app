// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
// const { GoogleGenerativeAI } = require("@google/generative-ai");
const fetch = require('node-fetch');
require('dotenv').config();


const fetch = require('node-fetch');

// Hugging Face Inference API configuration
const HF_API_URL = 'https://api-inference.huggingface.co/models';
const HF_TOKEN = process.env.HUGGING_FACE_API_TOKEN;

// Models for different tasks
const MODELS = {
  summarize: 'facebook/bart-large-cnn',
  improve: 'google/pegasus-xsum',
  ideas: 'EleutherAI/gpt-neo-1.3B'
};

// Helper function to make calls to Hugging Face API
async function query(model, payload) {
  const response = await fetch(`${HF_API_URL}/${model}`, {
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json'
    },
    method: 'POST',
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Hugging Face API Error: ${JSON.stringify(error)}`);
  }
  
  return await response.json();
}

// Initialize Gemini API
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// const model = genAI.getGenerativeModel({ model: "gemini-pro" });

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'https://ainotesapp.netlify.app', 'http://127.0.0.1:3000'],
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
app.post('/api/ai/summarize', async (req, res) => {
    try {
      const { text } = req.body;
      
      if (!text) {
        return res.status(400).json({ error: 'Text is required' });
      }
      
      const result = await query(MODELS.summarize, {
        inputs: text,
        parameters: {
          max_length: 150,
          min_length: 30,
          do_sample: false
        }
      });
      
      // Return the first generated summary
      res.json({ summary: result[0].summary_text });
    } catch (error) {
      console.error('Error with AI summarize:', error);
      res.status(500).json({ error: 'Failed to summarize text' });
    }
  });

// Improve writing
app.post('/api/ai/improve', async (req, res) => {
    try {
      const { text } = req.body;
      
      if (!text) {
        return res.status(400).json({ error: 'Text is required' });
      }
      
      const result = await query(MODELS.improve, {
        inputs: text,
        parameters: {
          max_length: 200,
          return_full_text: true
        }
      });
      
      res.json({ improved: result[0].generated_text });
    } catch (error) {
      console.error('Error with AI improve:', error);
      res.status(500).json({ error: 'Failed to improve text' });
    }
  });

// Generate ideas
app.post('/api/ai/ideas', async (req, res) => {
    try {
      const { topic } = req.body;
      
      if (!topic) {
        return res.status(400).json({ error: 'Topic is required' });
      }
      
      const prompt = `Generate 5 creative ideas about: ${topic}\n\n1.`;
      
      const result = await query(MODELS.ideas, {
        inputs: prompt,
        parameters: {
          max_length: 250,
          temperature: 0.7,
          top_p: 0.9,
          return_full_text: false
        }
      });
      
      // Process and format the ideas
      let ideasText = "1." + result[0].generated_text;
      const ideasArray = ideasText.split(/\d+\./).filter(item => item.trim() !== '');
      
      res.json({ ideas: ideasArray });
    } catch (error) {
      console.error('Error with AI ideas:', error);
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