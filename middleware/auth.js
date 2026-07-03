import jwt from 'jsonwebtoken'
import User from '../models/user.js'

// Vérifie le token JWT — bloque si absent ou invalide
export const protect = async (req, res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Non autorisé. Token manquant.' })
  }

  const token = header.split(' ')[1]
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(decoded.id)
    if (!user || !user.active) {
      return res.status(401).json({ message: 'Compte introuvable ou désactivé.' })
    }
    req.user = user
    next()
  } catch {
    return res.status(401).json({ message: 'Token invalide ou expiré.' })
  }
}

// Réserve la route aux admins uniquement
export const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Accès réservé aux administrateurs.' })
  }
  next()
}