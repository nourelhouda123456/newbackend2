 import express from 'express'
import { protect } from '../middleware/auth.js'
import { GoogleGenAI, Type } from '@google/genai'
import Task from '../models/task.js'
import Project from '../models/project.js'
import User from '../models/user.js'
import Notification from '../models/notification.js'
import { logActivity } from '../middleware/logger.js'

const router = express.Router()

// ═══════════════════════════════════════════════════════════════════════
// Fonction réutilisable : génère le résumé IA d'un projet
// Utilisée à la fois par GET /project-summary/:id ET par l'action vocale
// "get_project_summary" dans /execute — garantit un résultat identique
// peu importe le chemin emprunté (bouton ou voix).
// ═══════════════════════════════════════════════════════════════════════
async function buildProjectSummary(projectId, reqUser, { forSpeech = false } = {}) {
  const project = await Project.findById(projectId)
    .populate('owner', 'name email')
    .populate('assignedUsers', 'name email')

  if (!project) throw { status: 404, message: 'Projet introuvable.' }

  const isAdmin = reqUser.role === 'admin'
  const isMember = project.assignedUsers.some(u => u._id.toString() === reqUser._id.toString())
  if (!isAdmin && !isMember) throw { status: 403, message: 'Non autorisé sur ce projet.' }

  const tasks = await Task.find({ project: project._id })
    .populate('assignee', 'name email')
    .populate('owner', 'name email')

  const total = tasks.length
  const byStatus = { todo: 0, in_progress: 0, blocked: 0, done: 0 }
  tasks.forEach(t => byStatus[t.status]++)
  const completionRate = total ? Math.round((byStatus.done / total) * 100) : 0

  const now = new Date()
  const isOverdue = t => project.deadline && new Date(project.deadline) < now && t.status !== 'done'
  const overdueTasks = tasks.filter(isOverdue)
  const blockedTasks = tasks.filter(t => t.status === 'blocked')

  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)
  const recentChanges = tasks.flatMap(t =>
    t.statusHistory
      .filter(h => new Date(h.changedAt) >= sevenDaysAgo)
      .map(h => `"${t.title}": ${h.previousStatus || 'nouveau'} → ${h.newStatus}`)
  )

  const daysToDeadline = project.deadline
    ? Math.ceil((new Date(project.deadline) - now) / (1000 * 60 * 60 * 24))
    : null

  const teamStatus = project.assignedUsers.map(user => {
    const userTasks = tasks.filter(t => t.assignee?._id?.toString() === user._id.toString())
    const inProgressTask = userTasks.find(t => t.status === 'in_progress')
    const blockedTask = userTasks.find(t => t.status === 'blocked')

    let currentActivity = 'Aucune tâche active'
    let activityStatus = 'idle'
    if (blockedTask) {
      currentActivity = `Bloqué sur "${blockedTask.title}"`
      activityStatus = 'blocked'
    } else if (inProgressTask) {
      currentActivity = `En cours sur "${inProgressTask.title}"`
      activityStatus = 'in_progress'
    } else if (userTasks.some(t => t.status === 'todo')) {
      currentActivity = 'Tâches en attente, pas encore démarrées'
      activityStatus = 'todo'
    }

    return {
      userId: user._id.toString(),
      name: user.name,
      email: user.email,
      totalTasks: userTasks.length,
      done: userTasks.filter(t => t.status === 'done').length,
      currentActivity,
      activityStatus,
    }
  })

  // ── Instructions de rédaction adaptées selon le canal ──
  // forSpeech = true  → phrases fluides, sans markdown, adapté à la lecture à voix haute (assistant vocal)
  // forSpeech = false → structuré avec titres **gras**, adapté à l'affichage dans le modal (bouton Résumé IA)
  const writingInstructions = forSpeech
    ? `Rédige un résumé d'avancement du projet en français, en phrases naturelles et fluides,
adapté à une lecture à voix haute (pas de listes à puces, pas de symboles ** ou #, pas de titres).
Structure implicite: vue d'ensemble, points de vigilance, recommandation.
Reste factuel, base-toi uniquement sur les données fournies, sois concis (100 mots max).`
    : `Rédige un résumé d'avancement du projet en français, structuré ainsi:
1. Un paragraphe de synthèse générale (2-3 phrases)
2. Points de vigilance / risques (retards, blocages, membres inactifs)
3. Recommandation d'action concrète pour l'administrateur

Reste factuel, base-toi uniquement sur les données fournies, sois concis (150 mots max). Ne recopie pas la liste de l'équipe (elle est déjà affichée séparément), concentre-toi sur l'analyse.`

  const dataStr = `
Projet: ${project.name}
Description: ${project.description || 'N/A'}
Deadline: ${project.deadline ? new Date(project.deadline).toLocaleDateString('fr-FR') : 'Aucune'}
${daysToDeadline !== null ? `Jours restants avant deadline: ${daysToDeadline}` : ''}

Statistiques:
- Total tâches: ${total}
- À faire: ${byStatus.todo}
- En cours: ${byStatus.in_progress}
- Bloquées: ${byStatus.blocked}
- Terminées: ${byStatus.done}
- Taux de complétion: ${completionRate}%

Tâches en retard: ${overdueTasks.map(t => t.title).join(', ') || 'Aucune'}
Tâches bloquées: ${blockedTasks.map(t => `${t.title} (${t.assignee?.name || 'non assignée'})`).join(', ') || 'Aucune'}
Changements de statut ces 7 derniers jours: ${recentChanges.join(' | ') || 'Aucun'}

Équipe et activité actuelle:
${teamStatus.map(m => `- ${m.name}: ${m.currentActivity} (${m.done}/${m.totalTasks} tâches terminées)`).join('\n') || 'Aucun collaborateur affecté'}

Instructions:
${writingInstructions}
`

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: dataStr,
  })

  return {
    projectName: project.name,
    summary: response.text,
    stats: {
      total,
      byStatus,
      completionRate,
      overdueCount: overdueTasks.length,
      blockedCount: blockedTasks.length,
      teamStatus,
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// POST /api/ai/execute — Assistant vocal / commande en langage naturel
// ═══════════════════════════════════════════════════════════════════════
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
La valeur de "action" DOIT ÊTRE EXACTEMENT l'une des chaînes de caractères en anglais listées ci-dessous (ex: "add_comment", "create_task"). Ne la traduis pas.
Si tu ne peux pas déduire l'action, renvoie {"action": "error", "message": "Raison"}.

Correspondance des statuts : "bloqué" ou "bloquer" = "blocked", "en cours" = "in_progress", "terminé" = "done", "à faire" = "todo".
Si l'utilisateur dit "bloquer la tâche X", l'action est "update_task" avec le status "blocked".
Si l'utilisateur demande "le résumé du projet X", "l'état d'avancement de X", "où en est le projet X", "un rapport sur X", l'action est "get_project_summary" avec le projectId correspondant au nom X trouvé dans le contexte.

Structure JSON attendue (choisis UNE seule action parmi la liste suivante, et utilise EXACTEMENT le nom de l'action en anglais):

1. {"action": "create_task", "payload": {"title": "...", "description": "...", "project": "ID du projet (obligatoire)", "priority": "low|medium|high", "status": "todo|in_progress|blocked|done", "assignee": "ID (optionnel)", "visibility": "public|private"}}
2. {"action": "update_task", "payload": {"taskId": "ID (obligatoire)", "title": "...", "description": "...", "priority": "low|medium|high", "status": "todo|in_progress|blocked|done", "assignee": "ID (optionnel)", "visibility": "public|private"}}
3. {"action": "delete_task", "payload": {"taskId": "ID","title": "...","name": "..."}}
4. {"action": "create_project", "payload": {"name": "...", "deadline": "YYYY-MM-DD", "description": "..."}} (Seulement si admin)
5. {"action": "update_project", "payload": {"projectId": "ID", "name": "...", "description": "...", "deadline": "YYYY-MM-DD"}} (Seulement si admin)
6. {"action": "delete_project", "payload": {"projectId": "ID","name": "..."}} (Seulement si admin)
7. {"action": "create_user", "payload": {"name": "...", "email": "...", "password": "...", "role": "user|admin"}} (Seulement si admin)
8. {"action": "update_user", "payload": {"userId": "ID", "role": "user|admin", "active": true|false}} (Seulement si admin)
9. {"action": "delete_user", "payload": {"userId": "ID","name": "...",}} (Seulement si admin)
10. {"action": "add_collaborator", "payload": {"projectId": "ID", "userId": "ID", "name": "ID"}} (Admin ou owner du projet)
11. {"action": "remove_collaborator", "payload": {"projectId": "ID", "userId": "ID", "name": "ID"}} (Admin ou owner du projet)
12. {"action": "add_comment", "payload": {"taskId": "ID", "content": "..."}} (Pour envoyer un commentaire ou répondre à un commentaire)
13. {"action": "approve_request", "payload": {"taskId": "ID","title": "..."}} (Pour approuver une demande de réouverture, admin uniquement)
14. {"action": "ignore_request", "payload": {"taskId": "ID"}} (Pour ignorer/rejeter une demande de réouverture, admin uniquement)
15. {"action": "get_project_summary", "payload": {"projectId": "ID du projet (obligatoire, déduit du nom mentionné)"}} (Quand l'utilisateur demande un résumé, un état d'avancement, ou un rapport sur un projet)

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
       if (parsed.payload.description !== undefined) task.description = parsed.payload.description
       if (parsed.payload.priority) task.priority = parsed.payload.priority
       if (isAdmin) {
         if (parsed.payload.visibility) task.visibility = parsed.payload.visibility
         if (parsed.payload.assignee !== undefined) task.assignee = parsed.payload.assignee || null
       }
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

    if (parsed.action === 'add_comment') {
       const task = await Task.findById(parsed.payload.taskId)
       if (!task) return res.status(404).json({ message: 'Tâche introuvable.' })
       
       task.comments.push({
         author: req.user._id,
         content: parsed.payload.content
       })
       await task.save()
       
       return res.json({ message: "Commentaire ajouté avec succès", data: task, action: "add_comment" })
    }

    if (parsed.action === 'approve_request' || parsed.action === 'ignore_request') {
       if (!isAdmin) return res.status(403).json({ message: 'Seul un admin peut gérer les demandes de réouverture.' })
       
       const notif = await Notification.findOne({ task: parsed.payload.taskId, type: 'REOPEN_REQUEST', isRead: false })
       if (!notif) return res.status(404).json({ message: 'Aucune demande de réouverture en attente pour cette tâche.' })
       
       const task = await Task.findById(notif.task)
       if (!task) return res.status(404).json({ message: 'Tâche introuvable.' })
       
       if (parsed.action === 'approve_request') {
           const previousStatus = task.status
           const newStatus = 'in_progress'
           
           task.statusHistory.push({
             previousStatus, newStatus, changedBy: req.user._id, changedAt: new Date(), note: 'Réouverture approuvée par l\'administrateur via IA'
           })
           task.status = newStatus
           task.comments.push({ author: req.user._id, content: 'Demande de réouverture acceptée via assistant IA.' })
           await task.save()
           
           if (notif.sender) {
             await Notification.create({
               recipient: notif.sender, sender: req.user._id, task: task._id, project: task.project, type: 'APPROVE',
               message: `L'administrateur a approuvé votre demande de réouverture pour la tâche "${task.title}".`
             })
           }
           notif.isRead = true
           await notif.save()
           return res.json({ message: "Demande approuvée avec succès", data: task, action: "approve_request" })
       } else {
           task.comments.push({ author: req.user._id, content: 'Demande de réouverture ignorée via assistant IA.' })
           await task.save()
           
           if (notif.sender) {
             await Notification.create({
               recipient: notif.sender, sender: req.user._id, task: task._id, project: task.project, type: 'IGNORE',
               message: `L'administrateur a ignoré votre demande de réouverture pour la tâche "${task.title}".`
             })
           }
           notif.isRead = true
           await notif.save()
           return res.json({ message: "Demande ignorée avec succès", data: task, action: "ignore_request" })
       }
    }

    // ── Résumé de projet via commande vocale/texte ──
    // Utilise la même fonction que le bouton "Résumé IA" (buildProjectSummary),
    // mais avec forSpeech=true pour un texte adapté à la lecture à voix haute.
    if (parsed.action === 'get_project_summary') {
       try {
         const result = await buildProjectSummary(parsed.payload.projectId, req.user, { forSpeech: true })
         return res.json({
           message: result.summary,
           action: 'get_project_summary',
           speak: true,
           data: result
         })
       } catch (err) {
         if (err.status) return res.status(err.status).json({ message: err.message })
         throw err
       }
    }

    return res.status(400).json({ message: "Action non supportée", action: parsed.action })

  } catch (err) {
    console.error("AI Error:", err)
    res.status(500).json({ message: 'Erreur lors du traitement IA.', error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════════════
// GET /api/ai/project-summary/:projectId — Résumé IA d'un projet (bouton 🤖)
// Utilisé par ProjectSummaryModal.vue — inchangé pour le frontend existant.
// ═══════════════════════════════════════════════════════════════════════
router.get('/project-summary/:projectId', protect, async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ message: 'Clé API Gemini manquante côté serveur.' })
    }
    const result = await buildProjectSummary(req.params.projectId, req.user, { forSpeech: false })
    res.json(result)
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message })
    console.error('AI Summary Error:', err)
    res.status(500).json({ message: 'Erreur lors de la génération du résumé.', error: err.message })
  }
})

export default router