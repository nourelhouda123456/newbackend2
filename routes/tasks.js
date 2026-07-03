import express from 'express'
import Task from '../models/task.js'
import Project from '../models/project.js'
import Notification from '../models/notification.js'
import { protect, adminOnly } from '../middleware/auth.js'
import { logActivity } from '../middleware/logger.js'

const router = express.Router()

// Toutes les routes nécessitent d'être connecté
router.use(protect)

// GET /api/tasks
// - admin : toutes les tâches
// - user  : tâches des projets auxquels il est affecté
router.get('/', async (req, res) => {
  try {
    let query = {}

    if (req.user.role !== 'admin') {
      const userProjects = await Project.find({ assignedUsers: req.user._id })
      const projectIds = userProjects.map(p => p._id)
      query = { project: { $in: projectIds } }
    }

    if (req.query.projectId) {
      if (req.user.role !== 'admin') {
        const hasAccess = await Project.exists({ _id: req.query.projectId, assignedUsers: req.user._id })
        if (!hasAccess) {
          return res.status(403).json({ message: 'Accès refusé à ce projet.' })
        }
      }
      query.project = req.query.projectId
    }

    const tasks = await Task.find(query)
      .populate('owner', 'name email')
      .populate('assignee', 'name email')
      .populate('project', 'name description')
      .populate('comments.author', 'name email')
      .populate('statusHistory.changedBy', 'name email')
      .sort({ createdAt: -1 })

    res.json({ tasks })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// POST /api/tasks — Admin et Utilisateurs connectés
router.post('/', async (req, res) => {
  try {
    const { title, description, priority, visibility, assignee, status, project, documents } = req.body

    if (!title?.trim()) {
      return res.status(400).json({ message: 'Le titre est obligatoire.' })
    }

    if (!project) {
      return res.status(400).json({ message: 'Le projet est obligatoire pour créer une tâche.' })
    }

    const targetProject = await Project.findById(project)
    if (!targetProject) {
      return res.status(404).json({ message: 'Projet introuvable.' })
    }

    const isAdmin = req.user.role === 'admin'

    // Vérifier si l'utilisateur est affecté au projet
    if (!isAdmin) {
      const isAssigned = targetProject.assignedUsers.some(
        uId => uId.toString() === req.user._id.toString()
      )
      if (!isAssigned) {
        return res.status(403).json({ message: "Vous n'êtes pas affecté à ce projet. Vous ne pouvez pas y créer de tâche." })
      }

      // Un utilisateur simple ne peut pas assigner des tâches à d'autres personnes
      if (assignee && assignee.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: "Vous ne pouvez pas assigner cette tâche à un autre utilisateur." })
      }
    }

    const task = await Task.create({
      title:       title.trim(),
      description: description?.trim() || '',
      priority:    priority    || 'medium',
      visibility:  visibility  || 'private',
      status:      status      || 'todo',
      owner:       req.user._id,
      assignee:    assignee    || (isAdmin ? null : req.user._id), // Auto-assigne au créateur si simple utilisateur
      project:     targetProject._id,
      documents:   documents || [],
      // Premier événement dans l'historique
      statusHistory: [{
        previousStatus: null,
        newStatus:      status || 'todo',
        changedBy:      req.user._id,
        changedAt:      new Date(),
        note:           'Tâche créée',
      }],
    })

    await task.populate('owner', 'name email')
    await task.populate('assignee', 'name email')
    await task.populate('project', 'name description')

    await logActivity(req, 'TASK_CREATED', {
      taskId: task._id,
      title:  task.title,
      project: targetProject.name,
      assignee: task.assignee ? req.user.email : null,
    })

    res.status(201).json({ task })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// PUT /api/tasks/:id
router.put('/:id', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
    if (!task) return res.status(404).json({ message: 'Tâche introuvable.' })

    const isAdmin    = req.user.role === 'admin'
    const isAssignee = task.assignee && task.assignee.toString() === req.user._id.toString()
    const isOwner    = task.owner    && task.owner.toString()    === req.user._id.toString()

    // Seul admin, l'assignée ou le propriétaire peut modifier
    if (!isAdmin && !isAssignee && !isOwner) {
      return res.status(403).json({ message: 'Non autorisé.' })
    }

    const { title, description, status, priority, visibility, assignee, note, documents } = req.body

    // L’assignation et la visibilité sont réservées à l'admin
    if (!isAdmin) {
      if (assignee   !== undefined) return res.status(403).json({ message: "Seul un admin peut modifier l'assignation." })
      if (visibility !== undefined) return res.status(403).json({ message: 'Seul un admin peut modifier la visibilité.' })
    }

    // Enregistrement dans statusHistory si le statut change
    if (status !== undefined && status !== task.status) {
      if (task.status === 'done' && !isAdmin) {
        return res.status(403).json({ message: 'La tâche est terminée. Seul un administrateur peut la rouvrir.' })
      }
      
      const previousStatus = task.status

      task.statusHistory.push({
        previousStatus,
        newStatus:  status,
        changedBy:  req.user._id,
        changedAt:  new Date(),
        note:       note || '',
      })

      task.status = status

      await logActivity(req, 'TASK_STATUS_CHANGED', {
        taskId:         task._id,
        title:          task.title,
        previousStatus,
        newStatus:      status,
        changedBy:      req.user.name,
        reopenedByAdmin: isAdmin && previousStatus === 'done',
      })
    }

    // Mise à jour des autres champs
    if (title       !== undefined) task.title       = title.trim()
    if (description !== undefined) task.description = description.trim()
    if (priority    !== undefined && isAdmin) task.priority = priority
    if (documents   !== undefined) task.documents   = documents
    if (isAdmin) {
      if (visibility !== undefined) task.visibility = visibility
      if (assignee   !== undefined) task.assignee   = assignee || null
    }

    await task.save()
    await task.populate('owner', 'name email')
    await task.populate('assignee', 'name email')
    await task.populate('project', 'name description')
    await task.populate('comments.author', 'name email')
    await task.populate('statusHistory.changedBy', 'name email')

    await logActivity(req, 'TASK_UPDATED', {
      taskId:    task._id,
      title:     task.title,
      fields:    Object.keys(req.body),
      changedBy: req.user.name,
    })

    res.json({ task })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// DELETE /api/tasks/:id — Admin, propriétaire (owner) ou assignée peuvent supprimer
router.delete('/:id', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
    if (!task) return res.status(404).json({ message: 'Tâche introuvable.' })

    const isAdmin    = req.user.role === 'admin'
    const isOwner    = task.owner    && task.owner.toString()    === req.user._id.toString()
    const isAssignee = task.assignee && task.assignee.toString() === req.user._id.toString()

    if (!isAdmin && !isOwner && !isAssignee) {
      return res.status(403).json({ message: 'Non autorisé. Seul le propriétaire, l\'assignée ou un admin peut supprimer cette tâche.' })
    }

    await logActivity(req, 'TASK_DELETED', {
      taskId:    task._id,
      title:     task.title,
      deletedBy: req.user.name,
      role:      req.user.role,
    })

    await task.deleteOne()
    res.json({ message: 'Tâche supprimée.' })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// POST /api/tasks/:id/request-reopen — Demander la réouverture d'une tâche terminée
router.post('/:id/request-reopen', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
    if (!task) return res.status(404).json({ message: 'Tâche introuvable.' })

    if (task.status !== 'done') {
      return res.status(400).json({ message: 'La tâche n\'est pas terminée.' })
    }

    // 👇 Vérifier qu'il n'y a pas déjà une demande en attente pour cette tâche
    const existingRequest = await Notification.findOne({
      task: task._id,
      type: 'REOPEN_REQUEST',
      isRead: false
    })
    if (existingRequest) {
      return res.status(409).json({ message: 'Une demande de réouverture est déjà en attente pour cette tâche.' })
    }

    // Ajouter un commentaire pour tracer la demande
    task.comments.push({
      author: req.user._id,
      content: 'Demande de réouverture de la tâche suite à son statut Terminé.',
    })

    await task.save()

    // Créer la notification pour les administrateurs
    await Notification.create({
      forAdmin: true,
      sender: req.user._id,
      task: task._id,
      type: 'REOPEN_REQUEST',
      message: `${req.user.name} a demandé la réouverture de la tâche "${task.title}".`
    })

    await task.populate('owner', 'name email')
    await task.populate('assignee', 'name email')
    await task.populate('project', 'name description')
    await task.populate('comments.author', 'name email')
    await task.populate('statusHistory.changedBy', 'name email')

    res.json({ message: 'Demande envoyée avec succès.', task })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})
// POST /api/tasks/:id/comments — Ajouter un commentaire
router.post('/:id/comments', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
    if (!task) return res.status(404).json({ message: 'Tâche introuvable.' })

    // Doit avoir accès à la tâche pour commenter
    const isAdmin    = req.user.role === 'admin'
    const isAssignee = task.assignee && task.assignee.toString() === req.user._id.toString()
    const isPublic   = task.visibility === 'public'

    if (!isAdmin && !isAssignee && !isPublic) {
      return res.status(403).json({ message: 'Non autorisé.' })
    }

    const { content } = req.body
    if (!content?.trim()) {
      return res.status(400).json({ message: 'Le contenu du commentaire est obligatoire.' })
    }

    task.comments.push({
      author:  req.user._id,
      content: content.trim(),
    })

    await task.save()
    await task.populate('owner', 'name email')
    await task.populate('assignee', 'name email')
    await task.populate('project', 'name description')
    await task.populate('comments.author', 'name email')
    await task.populate('statusHistory.changedBy', 'name email')

    await logActivity(req, 'COMMENT_ADDED', { taskId: task._id, title: task.title })

    res.status(201).json({ task })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// DELETE /api/tasks/:id/comments/:commentId — Supprimer un commentaire
router.delete('/:id/comments/:commentId', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
    if (!task) return res.status(404).json({ message: 'Tâche introuvable.' })

    const comment = task.comments.id(req.params.commentId)
    if (!comment) return res.status(404).json({ message: 'Commentaire introuvable.' })

    // Seul l'auteur du commentaire ou l'admin peut supprimer
    const isCommentAuthor = comment.author.toString() === req.user._id.toString()
    if (!isCommentAuthor && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Non autorisé.' })
    }

    comment.deleteOne()
    await task.save()
    await task.populate('owner', 'name email')
    await task.populate('assignee', 'name email')
    await task.populate('project', 'name description')
    await task.populate('comments.author', 'name email')
    await task.populate('statusHistory.changedBy', 'name email')

    res.json({ task })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// GET /api/tasks/admin/all — admin uniquement, avec filtre owner
router.get('/admin/all', adminOnly, async (req, res) => {
  try {
    const tasks = await Task.find({})
      .populate('owner', 'name email')
      .populate('assignee', 'name email')
      .populate('project', 'name description')
      .populate('comments.author', 'name email')
      .populate('statusHistory.changedBy', 'name email')
      .sort({ createdAt: -1 })
    res.json({ tasks })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

export default router