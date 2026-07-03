import express from 'express'
import ActivityLog from '../models/activityLog.js'
import { protect, adminOnly } from '../middleware/auth.js'

const router = express.Router()

// Toutes les routes de logs nécessitent d'être admin
router.use(protect, adminOnly)

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

    const filter = {}

    if (req.query.action) {
      filter.action = req.query.action
    }
    if (req.query.userId) {
      filter.userId = req.query.userId
    }
    if (req.query.from || req.query.to) {
      filter.createdAt = {}
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from)
      if (req.query.to)   filter.createdAt.$lte = new Date(req.query.to)
    }

    const [logs, total] = await Promise.all([
      ActivityLog.find(filter)
        .populate('userId', 'name email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      ActivityLog.countDocuments(filter),
    ])

    res.json({
      logs,
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
    const actions = await ActivityLog.distinct('action')
    res.json({ actions: actions.sort() })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

export default router
