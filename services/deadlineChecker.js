import Project from '../models/project.js'
import Notification from '../models/notification.js'

const CHECK_INTERVAL_MS = 60 * 60 * 1000  // vérifier toutes les heures
const ALERT_DAYS        = [3, 1]           // alerter à J-3 et J-1

/**
 * Vérifie tous les projets avec deadline et envoie des alertes aux membres.
 */
export async function checkDeadlines() {
  try {
    const now     = new Date()
    // On cherche les projets dont la deadline est dans les 3 prochains jours
    const maxDate = new Date(now.getTime() + (ALERT_DAYS[0] + 1) * 24 * 60 * 60 * 1000)

    const projects = await Project.find({
      deadline: { $gte: now, $lte: maxDate },
    }).populate('assignedUsers', '_id name')

    for (const project of projects) {
      const deadline = new Date(project.deadline)
      const msLeft   = deadline - now
      const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000))

      // On n'alerte qu'aux paliers définis
      if (!ALERT_DAYS.includes(daysLeft)) continue

      // Anti-doublon : vérifier si une alerte a déjà été envoyée dans les 2 dernières heures
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
      const alreadySent = await Notification.findOne({
        type:      'DEADLINE_ALERT',
        project:   project._id,
        message:   { $regex: `J-${daysLeft}` },
        createdAt: { $gte: twoHoursAgo },
      })
      if (alreadySent) continue

      const dateStr = deadline.toLocaleDateString('fr-FR', {
        day: '2-digit', month: 'long', year: 'numeric'
      })

      const adminSenderId = project.assignedUsers[0]?._id
      if (!adminSenderId) continue  // Pas de membres, on skip

      // Notifier chaque membre du projet individuellement
      const notifPromises = project.assignedUsers.map(user =>
        Notification.create({
          forAdmin:  false,
          recipient: user._id,
          sender:    adminSenderId,
          project:   project._id,
          type:      'DEADLINE_ALERT',
          message:   `⚠️ J-${daysLeft} : La date limite du projet "${project.name}" est le ${dateStr}.`,
        })
      )

      // Notifier aussi les admins
      notifPromises.push(
        Notification.create({
          forAdmin: true,
          sender:   adminSenderId,
          project:  project._id,
          type:     'DEADLINE_ALERT',
          message:  `⚠️ J-${daysLeft} : Date limite du projet "${project.name}" le ${dateStr}.`,
        })
      )

      await Promise.allSettled(notifPromises)
      console.log(`🔔 Alerte deadline envoyée : "${project.name}" (J-${daysLeft})`)
    }
  } catch (err) {
    console.error('❌ Erreur deadlineChecker:', err.message)
  }
}

/**
 * Démarre le vérificateur périodique de deadlines.
 * À appeler une fois au démarrage du serveur.
 */
export function startDeadlineChecker() {
  console.log('⏰ Vérificateur de deadlines démarré (toutes les heures)')
  // Vérification immédiate au démarrage du serveur
  checkDeadlines()
  // Puis toutes les heures
  setInterval(checkDeadlines, CHECK_INTERVAL_MS)
}
