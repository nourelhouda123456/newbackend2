import express from 'express'
import Notification from '../models/notification.js'
import Task from '../models/task.js'
import { protect, adminOnly } from '../middleware/auth.js'
import { logActivity } from '../middleware/logger.js'

const router = express.Router()

// Toutes les routes nécessitent d'être connecté
router.use(protect)

// GET /api/notifications
// Admin: toutes les notifications forAdmin non lues
// User: ses propres notifications (recipient = lui) non lues
router.get('/', async (req, res) => {
  try {
    let query = {}
    if (req.user.role === 'admin') {
      // Admin voit ses notifs personnelles ET les notifs forAdmin
      query = {
        $or: [
          { forAdmin: true, isRead: false },
          { recipient: req.user._id, isRead: false },
        ]
      }
    } else {
      query = { recipient: req.user._id, isRead: false }
    }

    const notifications = await Notification.find(query)
      .populate('sender', 'name email')
      .populate('task', 'title status priority')
      .populate('project', 'name deadline')
      .sort({ createdAt: -1 })

    res.json({ notifications })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// PUT /api/notifications/:id/read
// Marquer une notification comme lue sans l'approuver
router.put('/:id/read', async (req, res) => {
  try {
    const notif = await Notification.findById(req.params.id)
    if (!notif) return res.status(404).json({ message: 'Notification introuvable.' })

    // Seul l'admin peut marquer les notifs forAdmin comme lues
    if (notif.forAdmin && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Non autorisé.' })
    }

    notif.isRead = true
    await notif.save()
    res.json({ message: 'Notification marquée comme lue.', notification: notif })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// PUT /api/notifications/:id/approve
// Approuver la demande de réouverture
router.put('/:id/approve', adminOnly, async (req, res) => {
  try {
    const notif = await Notification.findById(req.params.id)
    if (!notif) return res.status(404).json({ message: 'Notification introuvable.' })

    if (notif.type !== 'REOPEN_REQUEST') {
      return res.status(400).json({ message: 'Cette notification n\'est pas une demande de réouverture.' })
    }

    const task = await Task.findById(notif.task)
    if (!task) return res.status(404).json({ message: 'Tâche associée introuvable.' })

    // Changer le statut de la tâche (par ex. à in_progress)
    const previousStatus = task.status
    const newStatus = 'in_progress'

    task.statusHistory.push({
      previousStatus,
      newStatus,
      changedBy: req.user._id,
      changedAt: new Date(),
      note: 'Réouverture approuvée par l\'administrateur',
    })
    
    task.status = newStatus
    
    // Ajouter un commentaire automatique
    task.comments.push({
      author: req.user._id,
      content: 'Demande de réouverture acceptée. La tâche est de nouveau en cours.'
    })

    await task.save()
    
    await logActivity(req, 'TASK_STATUS_CHANGED', {
      taskId: task._id,
      title: task.title,
      previousStatus,
      newStatus,
      changedBy: req.user.name,
      reopenedByAdmin: true,
    })

    // Marquer la notif comme lue
    notif.isRead = true
    await notif.save()

    res.json({ message: 'Demande approuvée avec succès.', task })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

export default router
