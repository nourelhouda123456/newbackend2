import express from 'express'
import { protect, adminOnly } from '../middleware/auth.js'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import User from '../models/user.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const logsDir = path.join(__dirname, '..', 'logs')

const router = express.Router()

// Toutes les routes de logs nécessitent d'être admin
router.use(protect, adminOnly)

async function getAllLogs() {
  try {
    let allLogs = []

    // Lire le fichier courant du cycle actif
    try {
      const raw = await fs.readFile(path.join(logsDir, 'activity-logs.json'), 'utf-8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) allLogs = [...parsed]
    } catch { /* Pas encore de logs */ }

    return allLogs
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

// GET /api/logs
// Query params :
//   page     (défaut 1)
//   limit    (défaut 30, max 100)
//   action   (filtre exact, ex: LOGIN_SUCCESS)
//   userId   (filtre par utilisateur)
//   from     (date ISO début)
//   to       (date ISO fin)
router.get('/', async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1)
    const limit  = Math.min(100, parseInt(req.query.limit) || 30)
    const skip   = (page - 1) * limit

    let logs = await getAllLogs()

    if (req.query.action) {
      logs = logs.filter(log => log.action === req.query.action)
    }
    if (req.query.userId) {
      logs = logs.filter(log => log.userId === req.query.userId)
    }
    if (req.query.from) {
      const fromDate = new Date(req.query.from)
      logs = logs.filter(log => new Date(log.createdAt) >= fromDate)
    }
    if (req.query.to) {
      const toDate = new Date(req.query.to)
      logs = logs.filter(log => new Date(log.createdAt) <= toDate)
    }

    // Tri descendant
    logs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    const total = logs.length
    const paginatedLogs = logs.slice(skip, skip + limit)

    // Populate user details manually
    const userIdsToFetch = [...new Set(paginatedLogs.map(log => log.userId).filter(Boolean))]
    const users = await User.find({ _id: { $in: userIdsToFetch } }).select('name email role')
    const userMap = users.reduce((map, user) => {
      map[user._id.toString()] = user
      return map
    }, {})

    const finalLogs = paginatedLogs.map(log => ({
      ...log,
      userId: log.userId ? (userMap[log.userId] || log.userId) : null
    }))

    res.json({
      logs: finalLogs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// GET /api/logs/actions — liste des actions distinctes (pour les filtres UI)
router.get('/actions', async (req, res) => {
  try {
    const logs = await getAllLogs()
    const actions = [...new Set(logs.map(log => log.action))]
    res.json({ actions: actions.sort() })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

export default router
