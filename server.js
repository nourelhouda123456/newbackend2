import 'dotenv/config'
import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import fs from 'fs'
import passport from 'passport'
import authRoutes from './routes/auth.js'
import taskRoutes from './routes/tasks.js'
import userRoutes from './routes/users.js'
import logRoutes  from './routes/logs.js'
import aiRoutes from './routes/ai.js'
import projectRoutes from './routes/projects.js'
import uploadRoutes from './routes/upload.js'
import notificationRoutes from './routes/notifications.js'
import { seedAdmin } from './seed.js'
import { startDeadlineChecker } from './services/deadlineChecker.js'

// S'assurer que le dossier uploads existe
const uploadsDir = './uploads'
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}


const app = express()

// Faire confiance au proxy pour obtenir la vraie IP (X-Forwarded-For, etc.)
app.set('trust proxy', true)

// Middlewares
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }))
app.use(express.json())
app.use(passport.initialize())
app.use('/uploads', express.static('uploads'))

// Routes
app.use('/api/auth',  authRoutes)
app.use('/api/tasks', taskRoutes)
app.use('/api/users', userRoutes)
app.use('/api/logs',  logRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/projects', projectRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/notifications', notificationRoutes)

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }))

// Connexion MongoDB + seed + démarrage
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log(' MongoDB connecté')

    // Initialisation automatique de l'admin au premier démarrage
    await seedAdmin()

    // Démarrer le vérificateur de deadlines de projets
    startDeadlineChecker()

    app.listen(process.env.PORT || 3000, () => {
      console.log(` Serveur démarré sur http://localhost:${process.env.PORT || 3000}`)
    })
  })
  .catch(err => {
    console.error(' Erreur MongoDB :', err.message)
    process.exit(1)
  })