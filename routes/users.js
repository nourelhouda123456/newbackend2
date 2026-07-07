import express from 'express'
import User from '../models/user.js'
import { protect, adminOnly } from '../middleware/auth.js'

const router = express.Router()

// All user routes require authentication
router.use(protect)

// GET /api/users - List all users (admin only)
router.get('/', adminOnly, async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 })
    res.json({ users })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// PUT /api/users/profile - Update current user's name & email
router.put('/profile', async (req, res) => {
  try {
    const { name, email } = req.body

    if (!name?.trim() || !email?.trim()) {
      return res.status(400).json({ message: 'Le nom et l\'email sont obligatoires.' })
    }

    // Check if email already used by another user
    const existing = await User.findOne({ email: email.toLowerCase() })
    if (existing && existing._id.toString() !== req.user._id.toString()) {
      return res.status(409).json({ message: 'Cet email est déjà utilisé.' })
    }

    req.user.name = name.trim()
    req.user.email = email.trim().toLowerCase()
    const updatedUser = await req.user.save()

    res.json({ user: updatedUser })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// PUT /api/users/password - Update current user's password
router.put('/password', async (req, res) => {
  try {
    const { current, next } = req.body

    if (!current || !next) {
      return res.status(400).json({ message: 'Le mot de passe actuel et le nouveau sont requis.' })
    }

    // Find user with password selected (since it's excluded by toJSON)
    const user = await User.findById(req.user._id).select('+password')
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' })
    }

    const isValid = await user.comparePassword(current)
    if (!isValid) {
      return res.status(401).json({ message: 'Mot de passe actuel incorrect.' })
    }

    if (next.length < 6) {
      return res.status(400).json({ message: 'Le nouveau mot de passe doit faire au moins 6 caractères.' })
    }

    user.password = next
    await user.save()

    res.json({ message: 'Mot de passe modifié avec succès.' })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// PUT /api/users/:id/active - Toggle user active status (admin only)
router.put('/:id/active', adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'Vous ne pouvez pas désactiver votre propre compte.' })
    }

    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' })
    }

    user.active = !user.active
    await user.save()

    res.json({ user })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// PUT /api/users/:id/role - Change user role (admin only)
router.put('/:id/role', adminOnly, async (req, res) => {
  try {
    const { role } = req.body
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Rôle invalide.' })
    }

    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'Vous ne pouvez pas changer votre propre rôle.' })
    }

    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' })
    }

    user.role = role
    await user.save()

    res.json({ user })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// DELETE /api/users/:id - Delete a user (admin only)
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'Vous ne pouvez pas supprimer votre propre compte.' })
    }

    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' })
    }

    await user.deleteOne()
    res.json({ message: 'Utilisateur supprimé.' })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// POST /api/users/fcm-token - Save the FCM token for the current user
router.post('/fcm-token', async (req, res) => {
  try {
    const { token } = req.body
    if (!token) {
      return res.status(400).json({ message: 'Token FCM requis.' })
    }

    req.user.fcmToken = token
    await req.user.save()

    res.json({ message: 'Token FCM enregistré avec succès.' })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

export default router
