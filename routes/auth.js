import express from 'express'
import jwt from 'jsonwebtoken'
import passport from 'passport'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'
import { validate } from 'deep-email-validator'
import User from '../models/user.js'
import { protect } from '../middleware/auth.js'
import { logActivity } from '../middleware/logger.js'

const router = express.Router()

// ── JWT helper ────────────────────────────────────────────────────────────────
function signToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' })
}

// ── Google OAuth Strategy ────────────────────────────────────────────────────
// Configuré seulement si les clés Google sont présentes et valides
const isGoogleConfigured = process.env.GOOGLE_CLIENT_ID && 
                           process.env.GOOGLE_CLIENT_ID !== 'YOUR_GOOGLE_CLIENT_ID_HERE' &&
                           process.env.GOOGLE_CLIENT_SECRET &&
                           process.env.GOOGLE_CLIENT_SECRET !== 'YOUR_GOOGLE_CLIENT_SECRET_HERE'

if (isGoogleConfigured) {
  passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback',
    scope: ['profile', 'email'],
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email  = profile.emails?.[0]?.value?.toLowerCase()
      const name   = profile.displayName || profile.name?.givenName || 'Utilisateur Google'
      const avatar = profile.photos?.[0]?.value || null

      if (!email) return done(new Error('Email Google introuvable'), null)

      // Chercher un utilisateur existant par googleId ou par email
      let user = await User.findOne({ googleId: profile.id })

      if (!user) {
        // Peut-être qu'il a un compte email existant → lier le compte Google
        user = await User.findOne({ email })
        if (user) {
          user.googleId = profile.id
          user.avatar   = user.avatar || avatar
          await user.save()
        } else {
          // Créer un nouveau compte Google
          user = await User.create({
            name,
            email,
            googleId: profile.id,
            avatar,
            role:   'user',
            active: true,
          })
        }
      }

      if (!user.active) return done(new Error('Ce compte est désactivé.'), null)

      return done(null, user)
    } catch (err) {
      return done(err, null)
    }
  }))
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body

    const trimmedName  = name  ? name.trim()  : ''
    const trimmedEmail = email ? email.trim().toLowerCase() : ''

    if (!trimmedName || !trimmedEmail || !password) {
      return res.status(400).json({ message: 'Tous les champs sont obligatoires.' })
    }

    if (trimmedName.length < 2) {
      return res.status(400).json({ message: 'Le nom doit contenir au moins 2 caractères.' })
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Le mot de passe doit faire au moins 6 caractères.' })
    }

    // Validation réelle de l'email
    try {
      const emailValidation = await validate({
        email: trimmedEmail,
        validateRegex:      true,
        validateMx:         true,
        validateTypo:       true,
        validateDisposable: true,
        validateSMTP:       false, // SMTP souvent bloqué en localhost
      })

      // 🔍 LOG DEBUG — à retirer une fois le problème identifié
      console.log('📧 Résultat validation email:', JSON.stringify(emailValidation, null, 2))
 
    } catch (validationErr) {
      console.warn('⚠️ Échec validation e-mail (exception réseau):', validationErr.message)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        return res.status(400).json({ message: "Le format de l'adresse e-mail est invalide." })
      }
    }

    const existing = await User.findOne({ email: trimmedEmail })
    if (existing) {
      await logActivity(req, 'REGISTER_FAILED', { email: trimmedEmail, reason: 'Email déjà utilisé' })
      return res.status(409).json({ message: 'Cet email est déjà utilisé.' })
    }

    const user  = await User.create({ name: trimmedName, email: trimmedEmail, password, role: 'user' })
    const token = signToken(user._id)

    await logActivity(req, 'REGISTER_SUCCESS', { email: trimmedEmail, name: trimmedName }, user._id)

    res.status(201).json({ token, user })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ message: 'Email et mot de passe requis.' })
    }

    const user = await User.findOne({ email }).select('+password')
    if (!user) {
      await logActivity(req, 'LOGIN_FAILED', { email, reason: 'Utilisateur introuvable' })
      return res.status(401).json({ message: 'Email ou mot de passe incorrect.' })
    }
    if (!user.active) {
      await logActivity(req, 'LOGIN_FAILED', { email, reason: 'Compte désactivé' }, user._id)
      return res.status(403).json({ message: 'Ce compte est désactivé.' })
    }

    // Les comptes Google n'ont pas de mot de passe local
    if (!user.password) {
      await logActivity(req, 'LOGIN_FAILED', { email, reason: 'Compte Google — pas de mot de passe local' }, user._id)
      return res.status(400).json({ message: 'Ce compte utilise Google pour se connecter. Utilisez le bouton "Continuer avec Google".' })
    }

    const valid = await user.comparePassword(password)
    if (!valid) {
      await logActivity(req, 'LOGIN_FAILED', { email, reason: 'Mot de passe incorrect' }, user._id)
      return res.status(401).json({ message: 'Email ou mot de passe incorrect.' })
    }

    const token = signToken(user._id)
    await logActivity(req, 'LOGIN_SUCCESS', { email, role: user.role }, user._id)

    res.json({ token, user })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// ── GET /api/auth/google — Initie le flux OAuth Google ───────────────────────
router.get('/google', (req, res, next) => {
  if (!isGoogleConfigured) {
    return res.status(501).json({
      message: 'Google OAuth non configuré. Veuillez ajouter de vraies clés GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans le fichier .env'
    })
  }
  passport.authenticate('google', {
    scope:  ['profile', 'email'],
    prompt: 'select_account',
  })(req, res, next)
})

// ── GET /api/auth/google/callback — Callback Google ──────────────────────────
router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=google_failed` }),
  async (req, res) => {
    try {
      const user  = req.user
      const token = signToken(user._id)

      await logActivity(req, 'LOGIN_SUCCESS', { email: user.email, role: user.role, method: 'google' }, user._id)

      // Rediriger vers le frontend avec le token en paramètre de l'URL
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
      res.redirect(`${frontendUrl}/oauth/callback?token=${token}&user=${encodeURIComponent(JSON.stringify(user))}`)
    } catch (err) {
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=server_error`)
    }
  }
)

// ── GET /api/auth/check-email — Vérifier si un email est déjà utilisé ────────
router.get('/check-email', async (req, res) => {
  const email = req.query.email?.trim().toLowerCase()
  if (!email) return res.status(400).json({ valid: false, reason: 'Email manquant' })

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return res.json({ valid: false, reason: 'Format invalide' })
  }

  try {
    const existing = await User.findOne({ email })
    if (existing) {
      return res.json({ valid: false, exists: true, reason: 'Cet email est déjà utilisé' })
    }

    const result = await validate({
      email,
      validateRegex:      true,
      validateMx:         true,
      validateTypo:       false,
      validateDisposable: true,
      validateSMTP:       false,
    })

   

    res.json({ valid: true, exists: false })
  } catch {
    // En cas d'erreur réseau, valider si le format est correct
    res.json({ valid: true, exists: false })
  }
})

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', protect, async (req, res) => {
  try {
    await logActivity(req, 'LOGOUT', { email: req.user.email }, req.user._id)
    res.json({ message: 'Déconnecté avec succès.' })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', protect, (req, res) => {
  res.json({ user: req.user })
})

export default router