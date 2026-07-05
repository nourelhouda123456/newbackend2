import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const logsDir   = path.join(__dirname, '..', 'logs')
const logFile   = path.join(logsDir, 'activity-logs.json')
const metaFile  = path.join(logsDir, 'meta.json')

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

// Ensure logs directory exists on module load
fs.mkdir(logsDir, { recursive: true }).catch(console.error)

/**
 * Lit le méta-fichier (date de début du cycle courant).
 * Si le fichier n'existe pas, initialise un nouveau cycle.
 */
async function readMeta() {
  try {
    const raw = await fs.readFile(metaFile, 'utf-8')
    return JSON.parse(raw)
  } catch {
    // Premier démarrage : initialise le cycle
    const meta = { cycleStart: new Date().toISOString() }
    await fs.writeFile(metaFile, JSON.stringify(meta, null, 2))
    return meta
  }
}

/**
 * Vérifie si les 30 jours sont écoulés.
 * Si oui, archive le fichier courant et réinitialise le cycle.
 */
async function rotateIfNeeded(meta) {
  const cycleStart = new Date(meta.cycleStart)
  const now = new Date()

  if (now - cycleStart >= THIRTY_DAYS_MS) {
    // Archiver l'ancien fichier avec la date de début du cycle
    const stamp = cycleStart.toISOString().slice(0, 10)
    const archivePath = path.join(logsDir, `activity-logs-archive-${stamp}.json`)
    try {
      await fs.rename(logFile, archivePath)
      console.log(`📦  Logs archivés → ${archivePath}`)
    } catch {
      // Si le fichier n'existe pas, pas grave
    }

    // Réinitialiser le méta-fichier avec un nouveau cycle
    const newMeta = { cycleStart: now.toISOString() }
    await fs.writeFile(metaFile, JSON.stringify(newMeta, null, 2))
    return newMeta
  }

  return meta
}

/**
 * Récupère et normalise l'adresse IP réelle du client.
 * - Gère les proxy (X-Forwarded-For, X-Real-IP)
 * - Normalise les adresses IPv4-mappées IPv6 (::ffff:x.x.x.x → x.x.x.x)
 */
function getClientIP(req) {
  const raw =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.ip ||
    req.socket?.remoteAddress ||
    'unknown'

  if (raw.startsWith('::ffff:')) return raw.slice(7)
  if (raw === '::1') return '127.0.0.1'
  return raw
}

/**
 * Enregistre une entrée dans le journal d'activité (fichier JSON rolling 30 jours).
 *
 * @param {import('express').Request} req    - Requête Express (pour IP et UA)
 * @param {string}       action  - Code d'action (ex: 'LOGIN_SUCCESS')
 * @param {object}       details - Données contextuelles libres
 * @param {string|null}  userId  - ID utilisateur (si connu)
 */
export async function logActivity(req, action, details = {}, userId = null) {
  try {
    // Vérifier et potentiellement effectuer la rotation de 30 jours
    const meta = await readMeta()
    await rotateIfNeeded(meta)

    const now = new Date()
    const logEntry = {
      id:        Date.now().toString() + Math.random().toString(36).substring(2, 9),
      userId:    userId ?? req.user?._id ?? null,
      action,
      ip:        getClientIP(req),
      userAgent: req.headers['user-agent'] || '',
      details,
      createdAt: now.toISOString(),
    }

    // Lire le fichier courant (tableau JSON) ou démarrer avec un tableau vide
    let logs = []
    try {
      const raw = await fs.readFile(logFile, 'utf-8')
      logs = JSON.parse(raw)
      if (!Array.isArray(logs)) logs = []
    } catch {
      // Fichier inexistant ou corrompu → on repart de zéro
      logs = []
    }

    logs.push(logEntry)

    await fs.writeFile(logFile, JSON.stringify(logs, null, 2))
  } catch (err) {
    // On ne bloque jamais la requête principale si le log échoue
    console.warn('⚠️  logActivity error:', err.message)
  }
}
