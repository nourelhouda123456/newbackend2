import ActivityLog from '../models/activityLog.js'

/**
 * Récupère et normalise l'adresse IP réelle du client.
 * - Gère les proxy (X-Forwarded-For, X-Real-IP)
 * - Normalise les adresses IPv4-mappées IPv6 (::ffff:x.x.x.x → x.x.x.x)
 */
function getClientIP(req) {
  // Priorité : X-Forwarded-For (multi-proxy) > X-Real-IP > req.ip (trust proxy) > socket
  const raw =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.ip ||
    req.socket?.remoteAddress ||
    'unknown'

  // Normaliser ::ffff:x.x.x.x → x.x.x.x
  if (raw.startsWith('::ffff:')) {
    return raw.slice(7)
  }

  // Normaliser ::1 → 127.0.0.1 (loopback IPv6)
  if (raw === '::1') return '127.0.0.1'

  return raw
}

/**
 * Enregistre une entrée dans le journal d'activité.
 *
 * @param {import('express').Request} req - Requête Express (pour IP et UA)
 * @param {string}  action  - Code d'action (ex: 'LOGIN_SUCCESS')
 * @param {object}  details - Données contextuelles libres
 * @param {string|null} userId  - ID utilisateur (si connu)
 */
export async function logActivity(req, action, details = {}, userId = null) {
  try {
    await ActivityLog.create({
      userId:    userId ?? req.user?._id ?? null,
      action,
      ip:        getClientIP(req),
      userAgent: req.headers['user-agent'] || '',
      details,
    })
  } catch (err) {
    // On ne bloque jamais la requête principale si le log échoue
    console.warn('⚠️  logActivity error:', err.message)
  }
}
