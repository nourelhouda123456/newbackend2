import express from 'express'
import Project from '../models/project.js'
import Task from '../models/task.js'
import { protect, adminOnly } from '../middleware/auth.js'
import { logActivity } from '../middleware/logger.js'

const router = express.Router()

// Toutes les routes nécessitent une connexion
router.use(protect)

// GET /api/projects
// - admin : tous les projets
// - user  : projets où il est affecté
router.get('/', async (req, res) => {
  try {
    let query = {}
    if (req.user.role !== 'admin') {
      query = { assignedUsers: req.user._id }
    }

    const projects = await Project.find(query)
      .populate('owner', 'name email')
      .populate('assignedUsers', 'name email role active')
      .sort({ createdAt: -1 })

    res.json({ projects })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// POST /api/projects — Admin uniquement
router.post('/', adminOnly, async (req, res) => {
  try {
    const { name, description, assignedUsers, deadline, documents } = req.body

    if (!name?.trim()) {
      return res.status(400).json({ message: 'Le nom du projet est obligatoire.' })
    }

    const existing = await Project.findOne({ name: name.trim() })
    if (existing) {
      return res.status(409).json({ message: 'Un projet avec ce nom existe déjà.' })
    }

    const project = await Project.create({
      name:          name.trim(),
      description:   description?.trim() || '',
      owner:         req.user._id,
      assignedUsers: assignedUsers || [],
      deadline:      deadline || null,
      documents:     documents || [],
    })

    await project.populate('owner', 'name email')
    await project.populate('assignedUsers', 'name email role active')

    await logActivity(req, 'PROJECT_CREATED', {
      projectId: project._id,
      name:      project.name,
    })

    res.status(201).json({ project })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// PUT /api/projects/:id — Admin uniquement
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
    if (!project) return res.status(404).json({ message: 'Projet introuvable.' })

    const { name, description, assignedUsers, deadline, documents } = req.body

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ message: 'Le nom du projet ne peut pas être vide.' })
      }
      const existing = await Project.findOne({ name: name.trim(), _id: { $ne: project._id } })
      if (existing) {
        return res.status(409).json({ message: 'Un projet avec ce nom existe déjà.' })
      }
      project.name = name.trim()
    }

    if (description !== undefined) {
      project.description = description.trim()
    }

    if (assignedUsers !== undefined) {
      project.assignedUsers = assignedUsers
    }

    if (deadline !== undefined) {
      project.deadline = deadline || null
    }

    if (documents !== undefined) {
      project.documents = documents
    }

    await project.save()
    await project.populate('owner', 'name email')
    await project.populate('assignedUsers', 'name email role active')

    await logActivity(req, 'PROJECT_UPDATED', {
      projectId: project._id,
      name:      project.name,
    })

    res.json({ project })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

// DELETE /api/projects/:id — Admin uniquement
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
    if (!project) return res.status(404).json({ message: 'Projet introuvable.' })

    // Log the activity before deletion
    await logActivity(req, 'PROJECT_DELETED', {
      projectId: project._id,
      name:      project.name,
    })

    // Supprimer toutes les tâches liées au projet
    await Task.deleteMany({ project: project._id })

    // Supprimer le projet
    await project.deleteOne()

    res.json({ message: 'Projet et toutes ses tâches associés supprimés.' })
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.', error: err.message })
  }
})

export default router
