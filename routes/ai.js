import express from 'express'
import { protect } from '../middleware/auth.js'
import { GoogleGenAI, Type } from '@google/genai'
import Task from '../models/task.js'
import Project from '../models/project.js'
import User from '../models/user.js'
import { logActivity } from '../middleware/logger.js'

const router = express.Router()

router.post('/execute', protect, async (req, res) => {
  try {
    const { prompt } = req.body

    if (!prompt) {
      return res.status(400).json({ message: 'Le prompt est obligatoire.' })
    }

    if (!process.env.GEMINI_API_KEY) {
       return res.status(500).json({ message: 'Clé API Gemini manquante côté serveur.' })
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

    // Fetch context to help Gemini map names to IDs
    let projects = []
    if (req.user.role === 'admin') {
      projects = await Project.find({}).select('_id name')
    } else {
      projects = await Project.find({ assignedUsers: req.user._id }).select('_id name')
    }
    
    let users = []
    if (req.user.role === 'admin') {
       users = await User.find({}).select('_id name email')
    } else {
       // Regular users can only see themselves or people in their projects generally, 
       // but for simplicity we can pass basic info of all or just themselves.
       users = await User.find({}).select('_id name')
    }

    const tasks = await Task.find({ owner: req.user._id }).select('_id title')

    const contextStr = `
Contexte actuel:
ID Utilisateur connecté: ${req.user._id}
Rôle: ${req.user.role}
Projets (id: nom): ${projects.map(p => `${p._id}: ${p.name}`).join(', ')}
Utilisateurs (id: nom): ${users.map(u => `${u._id}: ${u.name}`).join(', ')}
Tâches existantes de l'utilisateur (id: titre): ${tasks.map(t => `${t._id}: ${t.title}`).join(', ')}

Instructions:
Tu es un agent intelligent qui traduit une requête en langage naturel en une action concrète JSON pour le système.
Analyse la requête suivante: "${prompt}"

Tu dois renvoyer STRICTEMENT un objet JSON valide correspondant à l'action.
Si tu ne peux pas déduire l'action, renvoie {"action": "error", "message": "Raison"}.

Structure JSON attendue (choisis UNE seule action parmi):

1. {"action": "create_task", "payload": {"title": "...", "description": "...", "project": "ID du projet (obligatoire)", "priority": "low|medium|high", "status": "todo|in_progress|blocked|done", "assignee": "ID (optionnel)", "visibility": "public|private"}}
2. {"action": "update_task", "payload": {"taskId": "ID", "title": "...", "status": "..."}}
3. {"action": "delete_task", "payload": {"taskId": "ID"}}
4. {"action": "create_project", "payload": {"name": "...", "description": "..."}} (Seulement si admin)
5. {"action": "update_project", "payload": {"projectId": "ID", "name": "...", "description": "...", "deadline": "YYYY-MM-DD"}} (Seulement si admin)
6. {"action": "delete_project", "payload": {"projectId": "ID"}} (Seulement si admin)
7. {"action": "create_user", "payload": {"name": "...", "email": "...", "password": "...", "role": "user|admin"}} (Seulement si admin)
8. {"action": "update_user", "payload": {"userId": "ID", "role": "user|admin", "active": true|false}} (Seulement si admin)
9. {"action": "delete_user", "payload": {"userId": "ID"}} (Seulement si admin)
10. {"action": "add_collaborator", "payload": {"projectId": "ID", "userId": "ID"}} (Admin ou owner du projet)
11. {"action": "remove_collaborator", "payload": {"projectId": "ID", "userId": "ID"}} (Admin ou owner du projet)

Associe les noms mentionnés dans la requête avec les IDs fournis dans le contexte.
`

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contextStr,
      config: {
        responseMimeType: "application/json"
      }
    })

    const resultText = response.text
    let parsed
    try {
      parsed = JSON.parse(resultText)
    } catch (e) {
      return res.status(500).json({ message: "La réponse de l'IA n'est pas un JSON valide.", raw: resultText })
    }

    if (parsed.action === 'error') {
       return res.status(400).json({ message: parsed.message || "L'IA n'a pas pu traiter la demande." })
    }

    // Execute the action
    const isAdmin = req.user.role === 'admin'

    if (parsed.action === 'create_task') {
      const { title, description, project, priority, status, assignee, visibility } = parsed.payload
      if (!title || !project) return res.status(400).json({ message: "Le titre et le projet sont obligatoires pour créer une tâche." })
      
      const targetProject = await Project.findById(project)
      if (!targetProject) return res.status(404).json({ message: 'Projet introuvable.' })
      
      if (!isAdmin && !targetProject.assignedUsers.some(uId => uId.toString() === req.user._id.toString())) {
        return res.status(403).json({ message: "Non autorisé sur ce projet." })
      }

      const task = await Task.create({
        title, description, priority: priority || 'medium', visibility: visibility || 'private',
        status: status || 'todo', owner: req.user._id, assignee: assignee || (isAdmin ? null : req.user._id),
        project: targetProject._id,
        statusHistory: [{ previousStatus: null, newStatus: status || 'todo', changedBy: req.user._id }]
      })
      return res.status(201).json({ message: "Tâche créée avec succès", data: task, action: "create_task" })
    }
    
    if (parsed.action === 'delete_task') {
       const task = await Task.findById(parsed.payload.taskId)
       if (!task) return res.status(404).json({ message: 'Tâche introuvable.' })
       const isOwner = task.owner.toString() === req.user._id.toString()
       const isAssignee = task.assignee && task.assignee.toString() === req.user._id.toString()
       if (!isAdmin && !isOwner && !isAssignee) return res.status(403).json({ message: 'Non autorisé.' })
       
       await task.deleteOne()
       return res.json({ message: "Tâche supprimée avec succès", action: "delete_task" })
    }

    if (parsed.action === 'update_task') {
       const task = await Task.findById(parsed.payload.taskId)
       if (!task) return res.status(404).json({ message: 'Tâche introuvable.' })
       const isOwner = task.owner.toString() === req.user._id.toString()
       const isAssignee = task.assignee && task.assignee.toString() === req.user._id.toString()
       if (!isAdmin && !isOwner && !isAssignee) return res.status(403).json({ message: 'Non autorisé.' })
       
       if (parsed.payload.title) task.title = parsed.payload.title
       if (parsed.payload.status && parsed.payload.status !== task.status) {
          task.statusHistory.push({ previousStatus: task.status, newStatus: parsed.payload.status, changedBy: req.user._id })
          task.status = parsed.payload.status
       }
       if (parsed.payload.description) task.description = parsed.payload.description
       await task.save()
       return res.json({ message: "Tâche modifiée avec succès", data: task, action: "update_task" })
    }

    if (['create_project', 'delete_project', 'update_project'].includes(parsed.action)) {
       if (!isAdmin) return res.status(403).json({ message: 'Seul un admin peut gérer les projets.' })
       
       if (parsed.action === 'create_project') {
          const p = await Project.create({ name: parsed.payload.name, description: parsed.payload.description, owner: req.user._id, assignedUsers: [req.user._id] })
          return res.status(201).json({ message: "Projet créé avec succès", data: p, action: "create_project" })
       } else if (parsed.action === 'delete_project') {
          await Project.findByIdAndDelete(parsed.payload.projectId)
          return res.json({ message: "Projet supprimé avec succès", action: "delete_project" })
       } else if (parsed.action === 'update_project') {
          const p = await Project.findById(parsed.payload.projectId)
          if (!p) return res.status(404).json({ message: 'Projet introuvable.' })
          if (parsed.payload.name) p.name = parsed.payload.name
          if (parsed.payload.description !== undefined) p.description = parsed.payload.description
          if (parsed.payload.deadline) p.deadline = new Date(parsed.payload.deadline)
          await p.save()
          return res.json({ message: "Projet modifié avec succès", data: p, action: "update_project" })
       }
    }

    if (['create_user', 'delete_user', 'update_user'].includes(parsed.action)) {
       if (!isAdmin) return res.status(403).json({ message: 'Seul un admin peut gérer les utilisateurs.' })
       
       if (parsed.action === 'create_user') {
          const u = await User.create({ name: parsed.payload.name, email: parsed.payload.email, password: parsed.payload.password || 'password123', role: parsed.payload.role || 'user' })
          return res.status(201).json({ message: "Utilisateur créé avec succès", data: u, action: "create_user" })
       } else if (parsed.action === 'delete_user') {
          await User.findByIdAndDelete(parsed.payload.userId)
          return res.json({ message: "Utilisateur supprimé avec succès", action: "delete_user" })
       } else if (parsed.action === 'update_user') {
          const u = await User.findById(parsed.payload.userId)
          if (!u) return res.status(404).json({ message: 'Utilisateur introuvable.' })
          if (parsed.payload.role) u.role = parsed.payload.role
          if (parsed.payload.active !== undefined) u.active = parsed.payload.active
          await u.save()
          return res.json({ message: "Utilisateur modifié avec succès", data: u, action: "update_user" })
       }
    }

    if (parsed.action === 'delete_user') {
       if (!isAdmin) return res.status(403).json({ message: 'Seul un admin peut gérer les utilisateurs.' })
       await User.findByIdAndDelete(parsed.payload.userId)
       return res.json({ message: "Utilisateur supprimé avec succès", action: "delete_user" })
    }

    if (parsed.action === 'add_collaborator') {
       const project = await Project.findById(parsed.payload.projectId)
       if (!project) return res.status(404).json({ message: 'Projet introuvable.' })
       
       const isOwner = project.owner.toString() === req.user._id.toString()
       if (!isAdmin && !isOwner) return res.status(403).json({ message: 'Seul le propriétaire ou un admin peut ajouter des collaborateurs.' })
       
       const userToAdd = await User.findById(parsed.payload.userId)
       if (!userToAdd) return res.status(404).json({ message: 'Utilisateur introuvable.' })
       
       const alreadyAssigned = project.assignedUsers.some(uId => uId.toString() === userToAdd._id.toString())
       if (!alreadyAssigned) {
           project.assignedUsers.push(userToAdd._id)
           await project.save()
       }
       return res.json({ message: "Collaborateur ajouté avec succès", data: project, action: "add_collaborator" })
    }

    if (parsed.action === 'remove_collaborator') {
       const project = await Project.findById(parsed.payload.projectId)
       if (!project) return res.status(404).json({ message: 'Projet introuvable.' })
       
       const isOwner = project.owner.toString() === req.user._id.toString()
       if (!isAdmin && !isOwner) return res.status(403).json({ message: 'Seul le propriétaire ou un admin peut retirer des collaborateurs.' })
       
       project.assignedUsers = project.assignedUsers.filter(uId => uId.toString() !== parsed.payload.userId)
       await project.save()
       
       return res.json({ message: "Collaborateur retiré avec succès", data: project, action: "remove_collaborator" })
    }

    return res.status(400).json({ message: "Action non supportée", action: parsed.action })

  } catch (err) {
    console.error("AI Error:", err)
    res.status(500).json({ message: 'Erreur lors du traitement IA.', error: err.message })
  }
})

export default router
